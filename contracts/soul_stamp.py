# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from urllib.parse import quote

# ── Constants ────────────────────────────────────────────────────────────────
VERIFICATION_EXPIRY_SECONDS = 86400 * 7   # 7 days
CONFIDENCE_THRESHOLD        = 65           # Minimum identity confidence to approve
BOT_FLAG_THRESHOLD          = 75           # Bot score >= this triggers auto-flag
SUPPORTED_PLATFORMS         = ["github", "twitter", "discord"]
MAX_ACCOUNTS_PER_ADDRESS    = 10

# ── Storage Dataclasses ───────────────────────────────────────────────────────

@allow_storage
@dataclass
class LinkedAccount:
    platform:         str
    username:         str
    profile_url:      str
    verified_at:      u256
    confidence_score: u32
    bot_score:        u32
    reasoning:        str
    is_active:        bool

@allow_storage
@dataclass
class PendingVerification:
    platform:          str
    username:          str
    profile_url:       str
    verification_code: str
    requested_at:      u256
    expires_at:        u256

@allow_storage
@dataclass
class AuditEntry:
    action:     str
    platform:   str
    username:   str
    result:     str
    confidence: u32
    bot_score:  u32
    timestamp:  u256

@allow_storage
@dataclass
class IdentityRecord:
    owner:              str
    linked_accounts:    DynArray[LinkedAccount]
    reputation_score:   u32
    is_flagged:         bool
    flag_reason:        str
    created_at:         u256
    last_updated:       u256
    verification_count: u32
    audit_log:          DynArray[AuditEntry]


# ── Contract ──────────────────────────────────────────────────────────────────

class SoulStamp(gl.Contract):
    """
    On-chain identity verification platform.

    Verification flow:
      1. User calls request_verification() → receives unique code to post
      2. User posts the code on their social media profile
      3. User calls complete_verification() → GenLayer LLMs fetch and validate
      4. If approved, the linked account is stored on-chain
    """

    # Persistent state
    identities:           TreeMap[str, IdentityRecord]
    pending_verifications: TreeMap[str, PendingVerification]
    platform_to_address:  TreeMap[str, str]   # "platform:username" → owner address
    all_addresses:        DynArray[str]        # ordered registry for admin enumeration
    admin:                str
    total_verifications:  u32
    total_identities:     u32
    discord_attestation_base_url: str

    # ── Constructor ──────────────────────────────────────────────────────────

    def __init__(self, admin_address: str) -> None:
        # TreeMap and DynArray fields are auto-initialized by the GenVM storage system.
        # Only set primitive types here.
        # admin_address is supplied at deploy time so the admin role is decoupled
        # from whoever signs the deployment transaction.
        if not admin_address or not admin_address.startswith("0x"):
            raise gl.vm.UserError("admin_address must be a valid 0x-prefixed address")
        self.admin               = self._addr(admin_address)
        self.total_verifications = u32(0)
        self.total_identities    = u32(0)
        self.discord_attestation_base_url = ""

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _addr(self, address) -> str:
        """
        Normalize any address (Address type or string, checksummed or not) to a
        lowercase hex string. MetaMask returns lowercase, GenLayer's Address
        stringifies to EIP-55 checksum case — we must align both ends.
        """
        return str(address).lower()

    def _normalize_platform(self, platform: str) -> str:
        p = platform.lower().strip()
        if p == "x":
            return "twitter"
        if p in ("discordapp", "discord_app"):
            return "discord"
        return p

    def _platform_key(self, platform: str, username: str) -> str:
        return f"{platform}:{username.lower().strip()}"

    def _generate_verification_code(self, caller: str, platform: str, username: str) -> str:
        """Deterministic unique code — caller + platform + username + block timestamp."""
        raw = f"SOULSTAMP:{caller}:{platform}:{username}:{int(datetime.now(timezone.utc).timestamp())}"
        digest = hashlib.sha256(raw.encode()).hexdigest()[:12].upper()
        return f"SOULSTAMP-VERIFY-{digest}"

    # ── Write Methods ─────────────────────────────────────────────────────────

    @gl.public.write
    def request_verification(self, platform: str, username: str, profile_url: str) -> None:
        """
        Step 1 — user requests verification for a social media account.
        Generates a unique code; user must post it publicly, then call complete_verification().
        """
        caller = self._addr(gl.message.sender_address)
        plat   = self._normalize_platform(platform)

        if plat not in SUPPORTED_PLATFORMS:
            raise gl.vm.UserError(f"Unsupported platform '{plat}'. Supported: {SUPPORTED_PLATFORMS}")

        if not username.strip() or not profile_url.strip():
            raise gl.vm.UserError("username and profile_url must not be empty")

        # Guard: already active on this platform?
        identity = self.identities.get(caller)
        if identity is not None:
            for acct in identity.linked_accounts:
                if (acct.platform == plat
                        and acct.username.lower() == username.lower()
                        and acct.is_active):
                    raise gl.vm.UserError(f"Already verified @{username} on {plat}")

            if int(identity.verification_count) >= MAX_ACCOUNTS_PER_ADDRESS:
                raise gl.vm.UserError(f"Maximum {MAX_ACCOUNTS_PER_ADDRESS} linked accounts reached")

        # Sybil guard: is this social account already owned by another address?
        pkey = self._platform_key(plat, username)
        existing_owner = self.platform_to_address.get(pkey)
        if existing_owner is not None and existing_owner != caller:
            raise gl.vm.UserError(f"@{username} on {plat} is already linked to another wallet address")

        code = self._generate_verification_code(caller, plat, username)

        self.pending_verifications[caller] = PendingVerification(
            platform=plat,
            username=username,
            profile_url=profile_url,
            verification_code=code,
            requested_at=u256(int(datetime.now(timezone.utc).timestamp())),
            expires_at=u256(int(datetime.now(timezone.utc).timestamp()) + VERIFICATION_EXPIRY_SECONDS),
        )

    @gl.public.write
    def complete_verification(self, fetch_url: str = "") -> None:
        """
        Step 2 — AI-powered verification.
        GenLayer LLMs autonomously fetch the social media content and validate
        that the unique code was posted. Records the verified link on-chain.

        Arguments:
          fetch_url:
            - GitHub: ignored. The contract reads GitHub's public user API and
              checks the `bio` field for the verification code.
            - Twitter: required. Must be a public tweet URL belonging to the
              claimed username (e.g. https://x.com/papito_dele/status/123...).
              The contract fetches Twitter's public oEmbed endpoint for that URL,
              which returns the tweet text/HTML in JSON form — readable by
              anonymous validators where the profile page itself is not.
        """
        caller  = self._addr(gl.message.sender_address)
        pending = self.pending_verifications.get(caller)

        if pending is None:
            raise gl.vm.UserError("No pending verification. Call request_verification() first.")

        if u256(int(datetime.now(timezone.utc).timestamp())) > pending.expires_at:
            raise gl.vm.UserError("Verification request expired. Please call request_verification() again.")

        plat        = pending.platform
        username    = pending.username
        profile_url = pending.profile_url
        code        = pending.verification_code

        # ── Decide what URL the validators will actually fetch ────────────────
        # Strategy: GitHub's public API returns compact account-quality signals
        # and the bio field. Twitter blocks anonymous profile renders behind a JS
        # shell, so we use Twitter's public oEmbed endpoint for a specific tweet.
        username_lc = username.lower()
        is_twitter  = (plat == "twitter")
        is_discord  = (plat == "discord")

        if is_twitter:
            if not fetch_url:
                raise gl.vm.UserError(
                    "Twitter verification requires a public tweet URL. "
                    "Post a tweet containing the verification code, then submit its URL."
                )
            url_lc = fetch_url.lower()
            # Tweet URL must belong to the claimed username (prevents pasting random tweets)
            valid_patterns = (
                f"twitter.com/{username_lc}/status/",
                f"x.com/{username_lc}/status/",
            )
            if not any(p in url_lc for p in valid_patterns):
                raise gl.vm.UserError(
                    f"Tweet URL must belong to @{username}. "
                    f"Expected pattern: https://x.com/{username}/status/..."
                )
            # Use Twitter's public oEmbed endpoint (no auth required, returns JSON).
            # Canonicalize to /i/status/<id> and percent-encode the URL so the
            # endpoint sees the tweet URL as a single query value.
            tweet_id = fetch_url.split("/status/", 1)[1].split("?", 1)[0].split("/", 1)[0]
            tweet_url = f"https://twitter.com/i/status/{tweet_id}"
            target_url = f"https://publish.twitter.com/oembed?url={quote(tweet_url, safe='')}&dnt=true&omit_script=true"
        elif is_discord:
            if not fetch_url:
                raise gl.vm.UserError(
                    "Discord verification requires an attestation URL from the SoulStamp Discord backend."
                )
            allowed_base = self.discord_attestation_base_url.rstrip("/")
            if not allowed_base:
                raise gl.vm.UserError("Discord attestation backend is not configured")
            expected_prefix = f"{allowed_base}/api/discord/attestations/"
            if not fetch_url.startswith(expected_prefix):
                raise gl.vm.UserError("Discord attestation URL is not from the configured backend")
            target_url = fetch_url
        else:
            # GitHub: use the public user API. It returns compact JSON with the
            # bio field, avoiding GitHub's large HTML shell where the bio can
            # appear after our content limit.
            target_url = f"https://api.github.com/users/{username}"

        # ── Non-deterministic block: fetch + LLM analysis ────────────────────

        def leader_fn():
            content = ""
            fetch_error = ""
            try:
                if is_twitter:
                    # oEmbed returns JSON over plain HTTP.
                    response = gl.nondet.web.get(target_url)
                    body = response.body
                    content = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else str(body)
                else:
                    # GitHub API returns compact JSON with the public bio.
                    response = gl.nondet.web.get(target_url)
                    body = response.body
                    content = body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else str(body)
            except Exception as e:
                content = ""
                fetch_error = str(e)

            content = content[:10000] if len(content) > 10000 else content

            if not content:
                reason = "Source content is empty or inaccessible"
                if fetch_error:
                    reason = f"{reason}: {fetch_error}"
                return {
                    "verification_code_found": False,
                    "code_in_bio": False,
                    "code_in_recent_post": False,
                    "account_age_category": "new",
                    "has_profile_picture": False,
                    "has_bio_text": False,
                    "post_activity_level": "none",
                    "cross_platform_signals": False,
                    "bot_indicators": [],
                    "is_likely_bot": False,
                    "bot_confidence": 0,
                    "identity_confidence": 0,
                    "reasoning": reason,
                }

            # The verification code check itself is exact and deterministic.
            # If it passes, account quality signals and an LLM assessment decide
            # the confidence score. If it fails, the LLM can only explain failure.
            exact_code_found = code in content

            if exact_code_found:
                account_age_category = "new"
                has_profile_picture = False
                has_bio_text = False
                post_activity_level = "low"
                cross_platform_signals = False
                signal_score = 88 if is_discord else (70 if is_twitter else 72)
                bot_score_signal = 18 if is_discord else (30 if is_twitter else 28)
                signal_notes = []

                try:
                    parsed = json.loads(content)
                except Exception:
                    parsed = {}

                if is_discord:
                    if not isinstance(parsed, dict):
                        return {
                            "verification_code_found": False,
                            "code_in_bio": False,
                            "code_in_recent_post": False,
                            "account_age_category": "new",
                            "has_profile_picture": False,
                            "has_bio_text": False,
                            "post_activity_level": "none",
                            "cross_platform_signals": False,
                            "bot_indicators": [],
                            "is_likely_bot": False,
                            "bot_confidence": 0,
                            "identity_confidence": 0,
                            "reasoning": "Discord attestation is not valid JSON",
                        }

                    discord_id = str(parsed.get("discord_id", "") or "").strip()
                    expected_discord_id = username.rsplit("#", 1)[-1].strip()
                    attestation_wallet = self._addr(parsed.get("wallet", ""))
                    attestation_platform = str(parsed.get("platform", "") or "").lower().strip()
                    attestation_code = str(parsed.get("verification_code", "") or "").strip()
                    attestation_expires_at = 0
                    try:
                        attestation_expires_at = int(parsed.get("expires_at", 0) or 0)
                    except Exception:
                        attestation_expires_at = 0

                    if attestation_platform != "discord":
                        return {
                            "verification_code_found": False,
                            "code_in_bio": False,
                            "code_in_recent_post": False,
                            "account_age_category": "new",
                            "has_profile_picture": False,
                            "has_bio_text": False,
                            "post_activity_level": "none",
                            "cross_platform_signals": False,
                            "bot_indicators": [],
                            "is_likely_bot": False,
                            "bot_confidence": 0,
                            "identity_confidence": 0,
                            "reasoning": "Discord attestation platform mismatch",
                        }
                    if attestation_wallet != caller:
                        return {
                            "verification_code_found": False,
                            "code_in_bio": False,
                            "code_in_recent_post": False,
                            "account_age_category": "new",
                            "has_profile_picture": False,
                            "has_bio_text": False,
                            "post_activity_level": "none",
                            "cross_platform_signals": False,
                            "bot_indicators": [],
                            "is_likely_bot": False,
                            "bot_confidence": 0,
                            "identity_confidence": 0,
                            "reasoning": "Discord attestation wallet mismatch",
                        }
                    if attestation_code != code:
                        return {
                            "verification_code_found": False,
                            "code_in_bio": False,
                            "code_in_recent_post": False,
                            "account_age_category": "new",
                            "has_profile_picture": False,
                            "has_bio_text": False,
                            "post_activity_level": "none",
                            "cross_platform_signals": False,
                            "bot_indicators": [],
                            "is_likely_bot": False,
                            "bot_confidence": 0,
                            "identity_confidence": 0,
                            "reasoning": "Discord attestation code mismatch",
                        }
                    if not discord_id or discord_id != expected_discord_id:
                        return {
                            "verification_code_found": False,
                            "code_in_bio": False,
                            "code_in_recent_post": False,
                            "account_age_category": "new",
                            "has_profile_picture": False,
                            "has_bio_text": False,
                            "post_activity_level": "none",
                            "cross_platform_signals": False,
                            "bot_indicators": [],
                            "is_likely_bot": False,
                            "bot_confidence": 0,
                            "identity_confidence": 0,
                            "reasoning": "Discord attestation user mismatch",
                        }
                    if attestation_expires_at < int(datetime.now(timezone.utc).timestamp()):
                        return {
                            "verification_code_found": False,
                            "code_in_bio": False,
                            "code_in_recent_post": False,
                            "account_age_category": "new",
                            "has_profile_picture": False,
                            "has_bio_text": False,
                            "post_activity_level": "none",
                            "cross_platform_signals": False,
                            "bot_indicators": [],
                            "is_likely_bot": False,
                            "bot_confidence": 0,
                            "identity_confidence": 0,
                            "reasoning": "Discord attestation expired",
                        }

                    display_name = str(parsed.get("display_name", "") or "").strip()
                    global_name = str(parsed.get("global_name", "") or "").strip()
                    username_text = str(parsed.get("username", "") or "").strip()
                    has_bio_text = bool(display_name or global_name or username_text)
                    has_profile_picture = bool(str(parsed.get("avatar_url", "") or "").strip())
                    cross_platform_signals = bool(parsed.get("email_verified", False))
                    post_activity_level = "none"

                    account_age_years = 0
                    try:
                        account_age_years = int(parsed.get("account_age_years", 0) or 0)
                    except Exception:
                        account_age_years = 0

                    if account_age_years >= 3:
                        account_age_category = "established"
                        signal_score += 7
                        bot_score_signal -= 5
                        signal_notes.append("Discord account is at least three years old")
                    elif account_age_years >= 1:
                        account_age_category = "moderate"
                        signal_score += 4
                        bot_score_signal -= 3
                        signal_notes.append("Discord account is at least one year old")

                    if has_profile_picture:
                        signal_score += 3
                        signal_notes.append("Discord account has an avatar")
                    if has_bio_text:
                        signal_score += 2
                        signal_notes.append("Discord account has public display identity")
                    if cross_platform_signals:
                        signal_score += 3
                        bot_score_signal -= 3
                        signal_notes.append("Discord OAuth reported a verified email")

                    signal_score = max(80, min(98, signal_score))
                    bot_score_signal = max(3, min(35, bot_score_signal))
                    return {
                        "verification_code_found": True,
                        "code_in_bio": False,
                        "code_in_recent_post": False,
                        "account_age_category": account_age_category,
                        "has_profile_picture": has_profile_picture,
                        "has_bio_text": has_bio_text,
                        "post_activity_level": post_activity_level,
                        "cross_platform_signals": cross_platform_signals,
                        "bot_indicators": [],
                        "is_likely_bot": bot_score_signal >= BOT_FLAG_THRESHOLD,
                        "bot_confidence": bot_score_signal,
                        "identity_confidence": signal_score,
                        "reasoning": "Discord OAuth attestation confirmed account control; score reflects account age, avatar, display identity, and verified-email signal.",
                    }

                elif is_twitter:
                    html = str(parsed.get("html", "")) if isinstance(parsed, dict) else content
                    author_url = str(parsed.get("author_url", "")) if isinstance(parsed, dict) else ""
                    author_name = str(parsed.get("author_name", "")) if isinstance(parsed, dict) else ""

                    has_bio_text = bool(author_name)
                    has_profile_picture = False
                    post_activity_level = "low"

                    if username_lc in author_url.lower():
                        signal_score += 8
                        bot_score_signal -= 5
                        signal_notes.append("oEmbed author URL matches claimed username")
                    if len(html) > 120:
                        signal_score += 4
                        signal_notes.append("tweet embed contains substantive public text")
                    if "twitter-tweet" in html:
                        signal_score += 3
                        bot_score_signal -= 2
                        signal_notes.append("source is a Twitter public embed")
                    if code in html:
                        signal_score += 5
                        bot_score_signal -= 3
                        signal_notes.append("exact code is in the tweet HTML")
                else:
                    public_repos = int(parsed.get("public_repos", 0) or 0) if isinstance(parsed, dict) else 0
                    followers = int(parsed.get("followers", 0) or 0) if isinstance(parsed, dict) else 0
                    created_at = str(parsed.get("created_at", "")) if isinstance(parsed, dict) else ""
                    bio = str(parsed.get("bio", "") or "") if isinstance(parsed, dict) else ""
                    avatar_url = str(parsed.get("avatar_url", "") or "") if isinstance(parsed, dict) else ""

                    has_profile_picture = bool(avatar_url)
                    has_bio_text = bool(bio.strip())
                    profile_fields = 0
                    for key in ("name", "company", "blog", "location", "twitter_username"):
                        if isinstance(parsed, dict) and str(parsed.get(key, "") or "").strip():
                            profile_fields += 1
                    if has_bio_text:
                        profile_fields += 1

                    created_year = 0
                    try:
                        created_year = int(created_at[:4])
                    except Exception:
                        created_year = 0
                    current_year = int(datetime.now(timezone.utc).year)
                    account_years = current_year - created_year if created_year else 0

                    if account_years >= 3:
                        account_age_category = "established"
                        signal_score += 14
                        bot_score_signal -= 8
                        signal_notes.append("GitHub account is at least three years old")
                    elif account_years >= 1:
                        account_age_category = "moderate"
                        signal_score += 9
                        bot_score_signal -= 5
                        signal_notes.append("GitHub account is at least one year old")

                    if public_repos >= 10:
                        post_activity_level = "high"
                        signal_score += 10
                        bot_score_signal -= 6
                        signal_notes.append("GitHub profile has ten or more public repositories")
                    elif public_repos >= 3:
                        post_activity_level = "moderate"
                        signal_score += 7
                        bot_score_signal -= 4
                        signal_notes.append("GitHub profile has multiple public repositories")
                    elif public_repos > 0:
                        post_activity_level = "low"
                        signal_score += 4
                        bot_score_signal -= 2
                        signal_notes.append("GitHub profile has at least one public repository")
                    else:
                        post_activity_level = "none"

                    if followers >= 50:
                        signal_score += 8
                        bot_score_signal -= 5
                        signal_notes.append("GitHub profile has fifty or more followers")
                    elif followers >= 10:
                        signal_score += 5
                        bot_score_signal -= 3
                        signal_notes.append("GitHub profile has ten or more followers")
                    elif followers > 0:
                        signal_score += 3
                        bot_score_signal -= 1
                        signal_notes.append("GitHub profile has at least one follower")

                    if has_profile_picture:
                        signal_score += 3
                        signal_notes.append("GitHub profile has an avatar")
                    if profile_fields >= 4:
                        signal_score += 7
                        bot_score_signal -= 3
                        signal_notes.append("GitHub profile has several completed profile fields")
                    elif profile_fields >= 2:
                        signal_score += 4
                        signal_notes.append("GitHub profile has some completed profile fields")
                    if isinstance(parsed, dict) and str(parsed.get("twitter_username", "") or "").strip():
                        cross_platform_signals = True
                        signal_score += 3
                        signal_notes.append("GitHub profile has a linked Twitter username")

                signal_score = max(70, min(98, signal_score))
                bot_score_signal = max(3, min(45, bot_score_signal))

                scoring_prompt = f"""You are scoring a SoulStamp identity proof.

The exact verification code was found in the public source, so proof of account control is established.
Now assess account quality and bot risk using the source and deterministic signals.

Platform: @{username} on {plat}
Verification Code: {code}
Deterministic signal score: {signal_score}
Deterministic bot risk score: {bot_score_signal}
Signals: {", ".join(signal_notes) if signal_notes else "limited public account quality signals"}

Source content excerpt:
---
{content}
---

Return JSON with EXACTLY:
{{
  "identity_confidence": <integer 70-98, stay within 15 points of deterministic signal score unless there is a clear reason>,
  "bot_confidence": <integer 0-100>,
  "is_likely_bot": <true | false>,
  "bot_indicators": <array of short strings, or []>,
  "reasoning": <one concise sentence explaining proof and quality signals>
}}
"""
                try:
                    ai_score = gl.nondet.exec_prompt(scoring_prompt, response_format="json")
                except Exception:
                    ai_score = {}

                def safe_int(value, default):
                    try:
                        return int(value)
                    except Exception:
                        digits = "".join(ch for ch in str(value) if ch.isdigit())
                        return int(digits) if digits else default

                def safe_bool(value, default=False):
                    if isinstance(value, bool):
                        return value
                    if isinstance(value, str):
                        lowered = value.strip().lower()
                        if lowered in ("true", "yes", "1"):
                            return True
                        if lowered in ("false", "no", "0", ""):
                            return False
                    return default

                ai_conf_raw = safe_int(ai_score.get("identity_confidence", signal_score), signal_score) if isinstance(ai_score, dict) else signal_score
                ai_bot_raw = safe_int(ai_score.get("bot_confidence", bot_score_signal), bot_score_signal) if isinstance(ai_score, dict) else bot_score_signal
                ai_conf = max(signal_score - 15, min(signal_score + 15, ai_conf_raw))
                ai_bot = max(bot_score_signal - 20, min(bot_score_signal + 20, ai_bot_raw))
                confidence = (signal_score * 2 + max(70, min(98, ai_conf))) // 3
                bot_confidence = (bot_score_signal * 2 + max(0, min(100, ai_bot))) // 3
                bot_indicators = ai_score.get("bot_indicators", []) if isinstance(ai_score, dict) else []
                if not isinstance(bot_indicators, list):
                    bot_indicators = [str(bot_indicators)]
                is_likely_bot = safe_bool(
                    ai_score.get("is_likely_bot", bot_confidence >= BOT_FLAG_THRESHOLD),
                    bot_confidence >= BOT_FLAG_THRESHOLD,
                ) if isinstance(ai_score, dict) else False
                reasoning = (
                    str(ai_score.get("reasoning", "")) if isinstance(ai_score, dict) else ""
                ).strip()
                if not reasoning:
                    reasoning = (
                        "Exact code proof succeeded; confidence reflects public account "
                        "age, activity, profile completeness, and bot-risk signals."
                    )

                return {
                    "verification_code_found": True,
                    "code_in_bio": not is_twitter,
                    "code_in_recent_post": is_twitter,
                    "account_age_category": account_age_category,
                    "has_profile_picture": has_profile_picture,
                    "has_bio_text": has_bio_text,
                    "post_activity_level": post_activity_level,
                    "cross_platform_signals": cross_platform_signals,
                    "bot_indicators": bot_indicators,
                    "is_likely_bot": is_likely_bot,
                    "bot_confidence": bot_confidence,
                    "identity_confidence": confidence,
                    "reasoning": reasoning,
                }

            if is_twitter:
                content_type = "Twitter oEmbed JSON response (the `html` field contains the tweet's text/HTML)"
            elif is_discord:
                content_type = "SoulStamp Discord OAuth attestation JSON response"
            else:
                content_type = "GitHub public user API JSON response (the `bio` field contains the profile bio)"

            prompt = f"""You are an identity verification engine for a blockchain platform called SoulStamp.

Your task: verify that a user has posted their verification code publicly on their {plat} account.

Details:
  Platform:          {plat}
  Username:          @{username}
  Source URL:        {target_url}
  Content type:      {content_type}
  Verification Code: {code}

Source content (excerpt):
---
{content}
---

Analyze the content and return a JSON object with EXACTLY these fields — no extra text:
{{
  "verification_code_found":  <true | false>,
  "code_in_bio":              <true | false>,
  "code_in_recent_post":      <true | false>,
  "account_age_category":     <"new" | "moderate" | "established">,
  "has_profile_picture":      <true | false>,
  "has_bio_text":             <true | false>,
  "post_activity_level":      <"none" | "low" | "moderate" | "high">,
  "cross_platform_signals":   <true | false>,
  "bot_indicators":           <array of strings describing specific bot-like patterns, or []>,
  "is_likely_bot":            <true | false>,
  "bot_confidence":           <integer 0-100; 0=human, 100=bot>,
  "identity_confidence":      <integer 0-100; overall trustworthiness score>,
  "reasoning":                <single sentence explaining the decision>
}}

Rules:
- verification_code_found must be true ONLY if the exact string "{code}" appears in the source content.
- For Twitter (oEmbed JSON), the code typically appears inside the `html` field of the response.
- For Discord, the code must appear in a trusted SoulStamp backend attestation.
- If the content is empty or inaccessible, set identity_confidence to 0 and verification_code_found to false.
- bot_confidence and identity_confidence are independent scores.
- Be concise in reasoning (one sentence max).
"""
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False

            # Re-run independently to get our own assessment
            my_result = leader_fn()
            if not isinstance(my_result, dict):
                return False

            # The binary verification decision must match exactly
            if my_result.get("verification_code_found") != leader_data.get("verification_code_found"):
                return False

            # Numeric scores must be within a reasonable tolerance
            bot_diff  = abs(int(my_result.get("bot_confidence", 0))  - int(leader_data.get("bot_confidence", 0)))
            conf_diff = abs(int(my_result.get("identity_confidence", 0)) - int(leader_data.get("identity_confidence", 0)))

            if bot_diff > 30 or conf_diff > 25:
                return False

            return True

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        # ── Process the AI result ─────────────────────────────────────────────

        if not isinstance(result, dict):
            raise gl.vm.UserError("AI verification returned an unexpected format. Please try again.")

        def result_bool(name, default=False):
            value = result.get(name, default)
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                lowered = value.strip().lower()
                if lowered in ("true", "yes", "1"):
                    return True
                if lowered in ("false", "no", "0", ""):
                    return False
            return default

        def result_int(name, default=0):
            value = result.get(name, default)
            try:
                return int(value)
            except Exception:
                digits = "".join(ch for ch in str(value) if ch.isdigit())
                return int(digits) if digits else default

        code_found   = result_bool("verification_code_found", False)
        confidence   = max(0, min(100, result_int("identity_confidence", 0)))
        bot_score    = max(0, min(100, result_int("bot_confidence", 0)))
        is_likely_bot = result_bool("is_likely_bot", False)
        reasoning    = str(result.get("reasoning", "No reasoning provided"))
        bot_indicators = result.get("bot_indicators", [])

        if not code_found:
            raise gl.vm.UserError(
                f"Verification code not detected in your {plat} profile. "
                f"Make sure '{code}' is publicly visible, then try again. "
                f"Reason: {reasoning}"
            )

        # ── Create or update identity record ──────────────────────────────────

        identity = self.identities.get(caller)
        is_new   = identity is None

        if is_new:
            identity = IdentityRecord(
                owner=caller,
                linked_accounts=[],
                reputation_score=u32(0),
                is_flagged=False,
                flag_reason="",
                created_at=u256(int(datetime.now(timezone.utc).timestamp())),
                last_updated=u256(int(datetime.now(timezone.utc).timestamp())),
                verification_count=u32(0),
                audit_log=[],
            )
            self.all_addresses.append(caller)
            self.total_identities = u32(int(self.total_identities) + 1)

        identity.linked_accounts.append(LinkedAccount(
            platform=plat,
            username=username,
            profile_url=profile_url,
            verified_at=u256(int(datetime.now(timezone.utc).timestamp())),
            confidence_score=u32(confidence),
            bot_score=u32(bot_score),
            reasoning=reasoning,
            is_active=True,
        ))

        # Weighted rolling average for reputation
        prev_count = int(identity.verification_count)
        prev_score = int(identity.reputation_score)
        new_score  = (prev_score * prev_count + confidence) // (prev_count + 1)
        identity.reputation_score   = u32(new_score)
        identity.verification_count = u32(prev_count + 1)
        identity.last_updated       = u256(int(datetime.now(timezone.utc).timestamp()))

        # Auto-flag bots
        if is_likely_bot or bot_score >= BOT_FLAG_THRESHOLD:
            identity.is_flagged  = True
            indicator_text = ", ".join(str(x) for x in bot_indicators) if bot_indicators else "none"
            identity.flag_reason = (
                f"Automated bot detection triggered (confidence {bot_score}%). "
                f"Indicators: {indicator_text}"
            )

        # Audit log
        identity.audit_log.append(AuditEntry(
            action="verification_completed",
            platform=plat,
            username=username,
            result="approved",
            confidence=u32(confidence),
            bot_score=u32(bot_score),
            timestamp=u256(int(datetime.now(timezone.utc).timestamp())),
        ))

        # Persist
        self.identities[caller]                              = identity
        self.platform_to_address[self._platform_key(plat, username)] = caller
        del self.pending_verifications[caller]
        self.total_verifications = u32(int(self.total_verifications) + 1)

    @gl.public.write
    def revoke_platform(self, platform: str, username: str) -> None:
        """Admin: remove a verified social media link."""
        caller = self._addr(gl.message.sender_address)
        if caller != self.admin:
            raise gl.vm.UserError("Only the admin can revoke verified links")

        plat   = self._normalize_platform(platform)
        pkey   = self._platform_key(plat, username)
        owner  = self.platform_to_address.get(pkey)

        if owner is None:
            raise gl.vm.UserError(f"No verified link found for @{username} on {plat}")

        identity = self.identities.get(owner)
        if identity is None:
            raise gl.vm.UserError("Identity record for linked account owner was not found")

        found = False
        for acct in identity.linked_accounts:
            if acct.platform == plat and acct.username.lower() == username.lower() and acct.is_active:
                acct.is_active = False
                found = True
                break

        if not found:
            raise gl.vm.UserError(f"No active verified link for @{username} on {plat}")

        if self.platform_to_address.get(pkey) == owner:
            del self.platform_to_address[pkey]

        identity.audit_log.append(AuditEntry(
            action="revoked",
            platform=plat,
            username=username,
            result="revoked_by_admin",
            confidence=u32(0),
            bot_score=u32(0),
            timestamp=u256(int(datetime.now(timezone.utc).timestamp())),
        ))
        identity.last_updated = u256(int(datetime.now(timezone.utc).timestamp()))
        self.identities[owner] = identity

    @gl.public.write
    def cancel_pending_verification(self) -> None:
        """Cancel an in-progress verification request."""
        caller = self._addr(gl.message.sender_address)
        if self.pending_verifications.get(caller) is None:
            raise gl.vm.UserError("No pending verification to cancel")
        del self.pending_verifications[caller]

    @gl.public.write
    def flag_identity(self, target: str, reason: str) -> None:
        """Admin: manually flag a suspicious identity."""
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can flag identities")
        target = self._addr(target)
        identity = self.identities.get(target)
        if identity is None:
            raise gl.vm.UserError("Identity not found")
        identity.is_flagged  = True
        identity.flag_reason = reason
        identity.last_updated = u256(int(datetime.now(timezone.utc).timestamp()))
        identity.audit_log.append(AuditEntry(
            action="admin_flagged",
            platform="",
            username="",
            result=reason,
            confidence=u32(0),
            bot_score=u32(0),
            timestamp=u256(int(datetime.now(timezone.utc).timestamp())),
        ))
        self.identities[target] = identity

    @gl.public.write
    def unflag_identity(self, target: str) -> None:
        """Admin: clear the flag on an identity."""
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can unflag identities")
        target = self._addr(target)
        identity = self.identities.get(target)
        if identity is None:
            raise gl.vm.UserError("Identity not found")
        identity.is_flagged  = False
        identity.flag_reason = ""
        identity.last_updated = u256(int(datetime.now(timezone.utc).timestamp()))
        identity.audit_log.append(AuditEntry(
            action="admin_unflagged",
            platform="",
            username="",
            result="cleared_by_admin",
            confidence=u32(0),
            bot_score=u32(0),
            timestamp=u256(int(datetime.now(timezone.utc).timestamp())),
        ))
        self.identities[target] = identity

    @gl.public.write
    def set_discord_attestation_base_url(self, base_url: str) -> None:
        """Admin: configure the trusted Discord attestation backend."""
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can configure Discord attestations")
        clean = base_url.strip().rstrip("/")
        if not clean.startswith("https://") and not clean.startswith("http://"):
            raise gl.vm.UserError("Discord attestation backend must be an http(s) URL")
        self.discord_attestation_base_url = clean

    @gl.public.write
    def transfer_admin(self, new_admin: str) -> None:
        """Transfer admin privileges to another address."""
        if self._addr(gl.message.sender_address) != self.admin:
            raise gl.vm.UserError("Only the admin can transfer admin role")
        self.admin = new_admin

    # ── View Methods ──────────────────────────────────────────────────────────

    @gl.public.view
    def get_identity(self, address: str) -> dict:
        """Full identity record for an address."""
        identity = self.identities.get(self._addr(address))
        if identity is None:
            return {"found": False}

        accounts = []
        for acct in identity.linked_accounts:
            if acct.is_active:
                accounts.append({
                    "platform":         acct.platform,
                    "username":         acct.username,
                    "profile_url":      acct.profile_url,
                    "verified_at":      int(acct.verified_at),
                    "confidence_score": int(acct.confidence_score),
                    "bot_score":        int(acct.bot_score),
                    "reasoning":        acct.reasoning,
                })

        return {
            "found":              True,
            "owner":              identity.owner,
            "linked_accounts":    accounts,
            "reputation_score":   int(identity.reputation_score),
            "is_flagged":         identity.is_flagged,
            "flag_reason":        identity.flag_reason,
            "created_at":         int(identity.created_at),
            "last_updated":       int(identity.last_updated),
            "verification_count": int(identity.verification_count),
        }

    @gl.public.view
    def get_pending_verification(self, address: str) -> dict:
        """Returns the pending verification including the code the user must post."""
        pending = self.pending_verifications.get(self._addr(address))
        if pending is None:
            return {"found": False}
        return {
            "found":             True,
            "platform":          pending.platform,
            "username":          pending.username,
            "profile_url":       pending.profile_url,
            "verification_code": pending.verification_code,
            "requested_at":      int(pending.requested_at),
            "expires_at":        int(pending.expires_at),
        }

    @gl.public.view
    def lookup_by_platform(self, platform: str, username: str) -> dict:
        """Find which address owns a given platform account."""
        plat  = self._normalize_platform(platform)
        owner = self.platform_to_address.get(self._platform_key(plat, username))
        if owner is None:
            return {"found": False}
        identity = self.identities.get(owner)
        if identity is None:
            return {"found": False}
        return {
            "found":              True,
            "owner_address":      owner,
            "reputation_score":   int(identity.reputation_score),
            "is_flagged":         identity.is_flagged,
            "verification_count": int(identity.verification_count),
        }

    @gl.public.view
    def is_platform_taken(self, platform: str, username: str) -> bool:
        """Returns true if this social account is already linked to any wallet."""
        plat = self._normalize_platform(platform)
        return self.platform_to_address.get(self._platform_key(plat, username)) is not None

    @gl.public.view
    def get_audit_log(self, address: str) -> list:
        """Full audit trail for a given address."""
        identity = self.identities.get(self._addr(address))
        if identity is None:
            return []
        return [
            {
                "action":     e.action,
                "platform":   e.platform,
                "username":   e.username,
                "result":     e.result,
                "confidence": int(e.confidence),
                "bot_score":  int(e.bot_score),
                "timestamp":  int(e.timestamp),
            }
            for e in identity.audit_log
        ]

    @gl.public.view
    def get_all_addresses(self, offset: u32, limit: u32) -> list:
        """Paginated list of all registered addresses (for admin/directory use)."""
        start = int(offset)
        end   = min(start + int(limit), len(self.all_addresses))
        return [self.all_addresses[i] for i in range(start, end)]

    @gl.public.view
    def get_stats(self) -> dict:
        """Platform-wide statistics."""
        return {
            "total_verifications": int(self.total_verifications),
            "total_identities":    int(self.total_identities),
            "admin":               self.admin,
            "supported_platforms": SUPPORTED_PLATFORMS,
            "discord_attestation_base_url": self.discord_attestation_base_url,
        }
