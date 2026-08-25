/**
 * icons.js — Clean, accessible SVG vector icon symbols for Explooro.
 * All icons are 24x24 viewBox, stroke-based with stroke="currentColor" and fill="none"
 * so their color dynamically responds to theme, hover, and active states.
 */

function svg(paths, { viewBox = '0 0 24 24', width = 18, height = 18, strokeWidth = 1.8 } = {}) {
  return `<svg viewBox="${viewBox}" width="${width}" height="${height}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export const ICONS = {
  // Navigation / Shell Groups
  overview: svg('<rect x="3" y="12" width="4" height="8" rx="1"></rect><rect x="10" y="8" width="4" height="12" rx="1"></rect><rect x="17" y="4" width="4" height="16" rx="1"></rect>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'),
  catalog: svg('<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5M12 12v10"></path>'),
  orders: svg('<circle cx="8" cy="21" r="1.5"></circle><circle cx="19" cy="21" r="1.5"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>'),
  finance: svg('<rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line><circle cx="16" cy="14" r="1.5" fill="currentColor"></circle>'),
  growth: svg('<path d="m3 11 18-5v12L3 13v-2z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path>'),
  content: svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>'),
  platform: svg('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'),
  security: svg('<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>'),
  queues: svg('<path d="M4 6h16M4 12h16M4 18h16"></path>'),
  cases: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>'),
  enforcement: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>'),
  my_access: svg('<path d="m21 2-2 2m-1.5 1.5L13 10m-3-3a5 5 0 1 0 7.07 7.07l6.93-6.93V2h-4.14z"></path>'),
  localization: svg('<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>'),
  inventory: svg('<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5M12 12v10"></path>'),
  aftercare: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path>'),
  engage: svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>'),
  my_shop: svg('<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path><path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7"></path>'),
  my_store: svg('<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"></path><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"></path><path d="M2 7h20"></path><path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7"></path>'),
  sourcing: svg('<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>'),
  marketing: svg('<path d="m3 11 18-5v12L3 13v-2z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path>'),
  vault: svg('<rect width="20" height="14" x="2" y="5" rx="2"></rect><line x1="2" x2="22" y1="10" y2="10"></line><circle cx="16" cy="14" r="1.5" fill="currentColor"></circle>'),
  rewards: svg('<polyline points="20 12 20 22 4 22 4 12"></polyline><rect width="20" height="5" x="2" y="7"></rect><line x1="12" x2="12" y1="22" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>'),
  protection: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>'),
  me: svg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'),
  bolt: svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>'),
  search: svg('<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>'),
  bell: svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>'),
  cart: svg('<circle cx="8" cy="21" r="1.5"></circle><circle cx="19" cy="21" r="1.5"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>'),
  star: svg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>'),

  // Navigation / Shell Items — one per distinct item function, so items within a group are
  // visually distinguishable instead of all repeating the group header's icon.
  dashboard: svg('<rect x="3" y="3" width="7" height="9" rx="1"></rect><rect x="14" y="3" width="7" height="5" rx="1"></rect><rect x="14" y="12" width="7" height="9" rx="1"></rect><rect x="3" y="16" width="7" height="5" rx="1"></rect>'),
  pulse: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>'),
  user_plus: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="16" y1="11" x2="22" y2="11"></line>'),
  id_card: svg('<rect x="2" y="5" width="20" height="14" rx="2"></rect><circle cx="9" cy="12" r="2"></circle><path d="M15 10h4M15 14h4"></path>'),
  award: svg('<circle cx="12" cy="8" r="5"></circle><path d="M8.5 13.5 6 22l6-3 6 3-2.5-8.5"></path>'),
  key: svg('<circle cx="7.5" cy="15.5" r="5.5"></circle><path d="m21 2-9.6 9.6"></path><path d="m15.5 7.5 3 3L22 7l-3-3"></path>'),
  check_circle: svg('<circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path>'),
  ban: svg('<circle cx="12" cy="12" r="10"></circle><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"></line>'),
  user_check: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><polyline points="16 11 18 13 22 9"></polyline>'),
  tag: svg('<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"></path><circle cx="7" cy="7" r="1" fill="currentColor"></circle>'),
  flag: svg('<path d="M4 22V4a1 1 0 0 1 1-1h13l-3 5 3 5H6a1 1 0 0 0-1 1v8"></path>'),
  layers: svg('<polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline>'),
  warehouse: svg('<path d="M3 21V9l9-6 9 6v12"></path><path d="M9 21v-6h6v6"></path><path d="M3 9h18"></path>'),
  undo: svg('<path d="M3 7v6h6"></path><path d="M3 13a9 9 0 1 0 3-7"></path>'),
  truck: svg('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle>'),
  receipt: svg('<path d="M4 2h16v20l-3-2-3 2-2-2-2 2-3-2-3 2Z"></path><line x1="8" y1="7" x2="16" y2="7"></line><line x1="8" y1="11" x2="16" y2="11"></line>'),
  book: svg('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 1 1 8 0v4"></path><circle cx="12" cy="16" r="1.5" fill="currentColor"></circle>'),
  wallet: svg('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path>'),
  pie_chart: svg('<path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path>'),
  link: svg('<path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><line x1="8" y1="12" x2="16" y2="12"></line>'),
  repeat: svg('<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'),
  circle_play: svg('<circle cx="12" cy="12" r="9"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon>'),
  graduation_cap: svg('<path d="M22 10 12 5 2 10l10 5 10-5Z"></path><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"></path>'),
  sparkles: svg('<path d="m12 3-1.9 4.9L5 9.8l4.1 3.2L7.6 18l4.4-2.9L16.4 18l-1.5-4.9L19 9.8l-6.1-1Z"></path>'),
  video: svg('<path d="m22 8-6 4 6 4V8Z"></path><rect x="2" y="6" width="14" height="12" rx="2"></rect>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>'),
  palette: svg('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2a10 10 0 1 0 0 20 1.5 1.5 0 0 0 1-2.6 1.5 1.5 0 0 1 1-2.6H16a4 4 0 0 0 4-4A9 9 0 0 0 12 2z"></path>'),
  plug: svg('<path d="M12 22v-5"></path><path d="M9 8V2"></path><path d="M15 8V2"></path><path d="M18 8v3a6 6 0 0 1-6 6v0a6 6 0 0 1-6-6V8Z"></path>'),
  clipboard_check: svg('<rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="m9 14 2 2 4-4"></path>'),
  monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>'),
  database: svg('<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path>'),
  film: svg('<rect x="2" y="3" width="20" height="18" rx="2"></rect><line x1="7" y1="3" x2="7" y2="21"></line><line x1="17" y1="3" x2="17" y2="21"></line><line x1="2" y1="9" x2="7" y2="9"></line><line x1="2" y1="15" x2="7" y2="15"></line><line x1="17" y1="9" x2="22" y2="9"></line><line x1="17" y1="15" x2="22" y2="15"></line>'),
  help_circle: svg('<circle cx="12" cy="12" r="10"></circle><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 2-3 4"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>'),
  trending_up: svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline><polyline points="16 7 22 7 22 13"></polyline>'),
  package: svg('<path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="m9 12 3 3 3-3"></path><path d="M12 15V9"></path>'),
  bar_chart: svg('<line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line>'),
  cart_search: svg('<circle cx="8" cy="21" r="1.5"></circle><circle cx="19" cy="21" r="1.5"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78"></path><circle cx="17" cy="8" r="3"></circle><line x1="19.5" y1="10.5" x2="22" y2="13"></line>'),
  wand: svg('<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"></path><path d="m14 7 3 3"></path><path d="M5 6v4"></path><path d="M19 14v4"></path><path d="M10 2v2"></path><path d="M7 8H3"></path><path d="M21 16h-4"></path><path d="M11 3H9"></path>'),
  share: svg('<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>'),
  coin: svg('<circle cx="12" cy="12" r="10"></circle><path d="M12 6v12"></path><path d="M15.5 9.5c0-1.5-1.6-2.5-3.5-2.5s-3.5 1-3.5 2.5c0 3 7 1.5 7 4.5 0 1.5-1.6 2.5-3.5 2.5s-3.5-1-3.5-2.5"></path>'),
  checklist: svg('<path d="m3 6 2 2 4-4"></path><path d="m3 13 2 2 4-4"></path><path d="m3 20 2 2 4-4"></path><line x1="12" y1="6" x2="21" y2="6"></line><line x1="12" y1="14" x2="21" y2="14"></line><line x1="12" y1="21" x2="21" y2="21"></line>'),
  trophy: svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>'),
  mail: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"></path><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"></path>'),
  heart: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"></path>'),
  map_pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle>'),
};

/**
 * item.key → ICONS name, one entry per nav item / simple-mode shortcut across every role so a
 * group's items are visually distinguishable instead of all repeating the group header's icon
 * (getItemIcon below falls back to the group icon only for a key this map doesn't cover).
 */
const ITEM_ICON_NAMES = {
  'admin.dashboard': 'dashboard', 'admin.health': 'pulse',
  'admin.users.list': 'user_plus', 'admin.staff': 'id_card', 'admin.roles': 'award', 'admin.grants': 'key',
  'admin.approvals': 'check_circle', 'admin.restrictions': 'ban', 'admin.verification': 'user_check',
  'admin.catalog.products': 'catalog', 'admin.catalog.categories': 'tag', 'admin.catalog.moderation': 'flag',
  'admin.catalog.batches': 'layers', 'admin.catalog.warehouses': 'warehouse',
  'admin.orders.list': 'orders', 'admin.returns': 'undo', 'admin.disputes': 'cases', 'admin.courier': 'truck',
  'admin.cod_reconciliation': 'receipt',
  'admin.finance.overview': 'overview', 'admin.finance.ledger': 'book', 'admin.finance.escrow': 'lock',
  'admin.finance.payouts': 'wallet', 'admin.finance.splits': 'pie_chart', 'admin.finance.b2b_escrow': 'link',
  'admin.finance.subscriptions': 'repeat',
  'admin.growth.ads': 'bell', 'admin.growth.coupons': 'tag', 'admin.growth.campaigns': 'flag',
  'admin.growth.referrals': 'share', 'admin.growth.coins': 'coin', 'admin.growth.quests': 'checklist',
  'admin.growth.groupbuy': 'users',
  'admin.content.banners': 'image', 'admin.content.stories': 'circle_play', 'admin.content.academy': 'graduation_cap',
  'admin.content.whats_new': 'sparkles', 'admin.content.translations': 'localization', 'admin.content.live': 'video',
  'admin.platform.modules': 'grid', 'admin.platform.theme': 'palette', 'admin.platform.integrations': 'plug',
  'admin.platform.apikeys': 'key', 'admin.platform.settings': 'platform',
  'admin.security.audit': 'clipboard_check', 'admin.security.sessions': 'monitor', 'admin.security.2fa': 'aftercare',
  'admin.security.ip_allowlist': 'localization', 'admin.security.backups': 'database',

  'moderator.dashboard': 'dashboard', 'moderator.queue': 'flag', 'moderator.reviews': 'star',
  'moderator.ugc': 'film', 'moderator.live': 'video', 'moderator.disputes': 'cases', 'moderator.returns': 'undo',
  'moderator.reports': 'flag', 'moderator.penalties': 'ban', 'moderator.my_access': 'my_access',

  'editor.dashboard': 'dashboard', 'editor.banners': 'image', 'editor.stories': 'circle_play',
  'editor.academy': 'graduation_cap', 'editor.whats_new': 'sparkles', 'editor.help_center': 'help_circle',
  'editor.translations': 'localization',

  'supplier.dashboard': 'dashboard', 'supplier.resellers': 'users', 'supplier.forecasting': 'trending_up',
  'supplier.products': 'catalog', 'supplier.stock': 'inventory', 'supplier.batches': 'layers',
  'supplier.warehouses': 'warehouse', 'supplier.orders.incoming': 'orders', 'supplier.fulfilment': 'package',
  'supplier.shipments': 'truck', 'supplier.warranty_claims': 'aftercare', 'supplier.vault': 'vault',
  'supplier.b2b_escrow': 'link', 'supplier.inquiries': 'engage', 'supplier.live_studio': 'video',
  'supplier.store_status': 'my_shop',

  'saler.dashboard': 'dashboard', 'saler.analytics': 'bar_chart', 'saler.cart_insights': 'cart_search',
  'saler.store_builder': 'my_store', 'saler.products': 'catalog', 'saler.store_status': 'my_shop',
  'saler.sourcing': 'sourcing', 'saler.bundles': 'layers', 'saler.creative_studio': 'wand',
  'saler.social_kit': 'share', 'saler.ads': 'bell', 'saler.live_studio': 'video', 'saler.orders': 'orders',
  'saler.vault.balance': 'vault', 'saler.vault.payouts': 'wallet', 'saler.referrals': 'share',
  'saler.quests': 'checklist', 'saler.leaderboard': 'trophy', 'saler.academy': 'graduation_cap',
  'saler.inbox': 'mail',

  'customer.orders': 'orders', 'customer.returns': 'undo', 'customer.wishlist': 'heart',
  'customer.coupons': 'tag', 'customer.team_purchases': 'users', 'customer.live': 'video',
  'customer.coins': 'coin', 'customer.referrals': 'share', 'customer.warranties': 'aftercare',
  'customer.following': 'user_check', 'customer.reviews': 'star', 'customer.addresses': 'map_pin',
  'customer.settings': 'platform', 'customer.become_saler': 'bolt',

  'saler.simple.add_product': 'catalog', 'saler.simple.share_store': 'my_store', 'saler.simple.my_orders': 'orders',
  'saler.simple.my_earnings': 'vault', 'saler.simple.messages': 'engage', 'saler.simple.help': 'graduation_cap',
  'supplier.simple.add_product': 'catalog', 'supplier.simple.stock': 'inventory',
  'supplier.simple.orders_to_pack': 'orders', 'supplier.simple.print_labels': 'package',
  'supplier.simple.my_earnings': 'vault', 'supplier.simple.help': 'dashboard',
};

export function getGroupIcon(groupKey) {
  const shortKey = groupKey?.split('.')?.pop() || groupKey;
  return ICONS[shortKey] || ICONS[groupKey] || ICONS.overview;
}

/**
 * The SVG markup to render for one nav item — an inline `<svg>` string on the item itself, else
 * its function-specific icon from ITEM_ICON_NAMES, else the parent group's icon as a last resort.
 */
export function getItemIcon(item) {
  if (item.icon && typeof item.icon === 'string' && item.icon.trim().startsWith('<svg')) return item.icon;
  const name = ITEM_ICON_NAMES[item.key];
  if (name && ICONS[name]) return ICONS[name];
  if (item.group) return getGroupIcon(item.group);
  return null;
}

/**
 * Explooro Brand Logo Mark
 * "E." wordmark badge, hand-drawn "E" glyph: bars grow top → bottom (top
 * smallest, middle a bit longer, bottom longest) — matching the supplied
 * logo, not a font "E" or the earlier top/bottom-equal draft — plus a
 * diamond (rotated square), not a round dot, standing in for the period.
 * Fill color (#A6337E) is hand-matched by eye to the supplied logo image —
 * no exact hex/eyedropper value was provided, so nudge this if it's off.
 */
export function getExplooroLogoSvg({ size = 28, className = 'explooro-logo-mark' } = {}) {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="${className}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="#A6337E" />
    <!-- 'E' glyph: left stem + three bars, growing top -> bottom -->
    <rect x="8.5" y="7" width="3" height="18" fill="#ffffff" />
    <rect x="8.5" y="7" width="8" height="3.4" fill="#ffffff" />
    <rect x="8.5" y="14.3" width="10.5" height="3.4" fill="#ffffff" />
    <rect x="8.5" y="21.6" width="13" height="3.4" fill="#ffffff" />
    <!-- Period, drawn as a diamond (rotated square), not a circle -->
    <rect x="22.5" y="20.5" width="5" height="5" rx="0.6" fill="#ffffff" transform="rotate(45 25 23)" />
  </svg>`;
}
