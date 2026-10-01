export function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} не найден`)
  return el
}

let toastTimer = 0
export function showToast(text: string, ms = 2600): void {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => { t.hidden = true }, ms)
}

const NAME_KEY = 'office-rage:name'

export function loadName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}

export function saveName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name) } catch { /* приватный режим — не страшно */ }
}

export function loadPref(key: string): string | null {
  try { return localStorage.getItem(`office-rage:${key}`) } catch { return null }
}

export function savePref(key: string, value: string): void {
  try { localStorage.setItem(`office-rage:${key}`, value) } catch { /* не страшно */ }
}
