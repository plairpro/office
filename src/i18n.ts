// Язык интерфейса — по языку браузера: русский для ru-*, для всех остальных английский.
// ?lang=en / ?lang=ru — принудительно (для проверки).
const forced = new URLSearchParams(location.search).get('lang')
const browser = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase()
export const LANG: 'ru' | 'en' = (forced ?? browser).toLowerCase().startsWith('ru') ? 'ru' : 'en'
export const isRu = LANG === 'ru'

/** Строка на нужном языке */
export const tr = (ru: string, en: string): string => (isRu ? ru : en)

/**
 * Перевод статичной разметки: у элементов с data-en подменяется содержимое,
 * data-en-placeholder / data-en-title / data-en-aria — соответствующие атрибуты.
 */
export function translateDom(root: ParentNode = document): void {
  document.documentElement.lang = LANG
  if (isRu) return
  document.title = 'Office'
  root.querySelectorAll<HTMLElement>('[data-en]').forEach((el) => { el.innerHTML = el.dataset.en! })
  root.querySelectorAll<HTMLElement>('[data-en-placeholder]').forEach((el) => el.setAttribute('placeholder', el.dataset.enPlaceholder!))
  root.querySelectorAll<HTMLElement>('[data-en-title]').forEach((el) => el.setAttribute('title', el.dataset.enTitle!))
  root.querySelectorAll<HTMLElement>('[data-en-aria]').forEach((el) => el.setAttribute('aria-label', el.dataset.enAria!))
}
