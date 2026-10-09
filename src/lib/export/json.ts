export function downloadJson<T extends object>(filename: string, data: T): void {
  const payload = {
    exportSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
