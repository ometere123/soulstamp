export function evidenceAssuranceLabel(proofStrength?: string, riskBand?: string): string {
  const strength = (proofStrength || "MEDIUM").toUpperCase();
  const risk = (riskBand || "medium").toLowerCase();
  return `${strength} evidence · ${risk} protocol risk`;
}
