# genlayer-test auto-loads the direct-mode fixtures through its pytest plugin.
# Its fd-0 injection closes the temporary handle before Windows releases the
# duplicated stdin handle. Keep the fixture-owned temp file until VM cleanup;
# this only intercepts that narrow Windows temp-file unlink race.
import os

_unlink = os.unlink


def _direct_test_unlink(path, *args, **kwargs):
    try:
        return _unlink(path, *args, **kwargs)
    except PermissionError:
        text = str(path).replace("/", "\\")
        if "\\Temp\\tmp" in text and os.name == "nt":
            return None
        raise


os.unlink = _direct_test_unlink
