/**
 * Icon shapes ported verbatim from prototype/src/ui-core.js (ICONS). 24x24 grid, drawn as outlines (stroke 2, round caps).
 * Generated once from the prototype; edit by hand from here on.
 */
export type IconShape = readonly [tag: 'path' | 'circle' | 'rect' | 'polygon', attrs: Readonly<Record<string, string>>];

export const iconShapes = {
  heart: [["path",{"d":"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"}]],
  chat: [["path",{"d":"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"}]],
  bookmark: [["path",{"d":"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"}]],
  send: [["path",{"d":"m22 2-7 20-4-9-9-4Z"}],["path",{"d":"M22 2 11 13"}]],
  bell: [["path",{"d":"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"}],["path",{"d":"M10.3 21a1.94 1.94 0 0 0 3.4 0"}]],
  home: [["path",{"d":"m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}],["path",{"d":"M9 22V12h6v10"}]],
  search: [["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],
  tag: [["path",{"d":"M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"}],["circle",{"cx":"7.5","cy":"7.5","r":"1.5"}]],
  box: [["path",{"d":"M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"}],["path",{"d":"M3.3 7 12 12l8.7-5"}],["path",{"d":"M12 22V12"}]],
  user: [["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],
  plus: [["path",{"d":"M12 5v14M5 12h14"}]],
  back: [["path",{"d":"m15 18-6-6 6-6"}]],
  x: [["path",{"d":"M18 6 6 18M6 6l12 12"}]],
  check: [["path",{"d":"M20 6 9 17l-5-5"}]],
  store: [["path",{"d":"M3 9 4.5 4h15L21 9"}],["path",{"d":"M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"}],["path",{"d":"M5 13v7h14v-7"}]],
  cart: [["circle",{"cx":"9","cy":"21","r":"1"}],["circle",{"cx":"20","cy":"21","r":"1"}],["path",{"d":"M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"}]],
  chart: [["path",{"d":"M3 3v18h18"}],["path",{"d":"M7 16v-5M12 16V8M17 16v-9"}]],
  clock: [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 6v6l4 2"}]],
  pin: [["path",{"d":"M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"}],["circle",{"cx":"12","cy":"10","r":"3"}]],
  upload: [["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["path",{"d":"m17 8-5-5-5 5"}],["path",{"d":"M12 3v12"}]],
  trash: [["path",{"d":"M3 6h18"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],
  edit: [["path",{"d":"M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"}]],
  volume: [["path",{"d":"M11 5 6 9H2v6h4l5 4V5z"}],["path",{"d":"M15.5 8.5a5 5 0 0 1 0 7"}]],
  mute: [["path",{"d":"M11 5 6 9H2v6h4l5 4V5z"}],["path",{"d":"m22 9-6 6M16 9l6 6"}]],
  lock: [["rect",{"x":"3","y":"11","width":"18","height":"11","rx":"2"}],["path",{"d":"M7 11V7a5 5 0 0 1 10 0v4"}]],
  eye: [["path",{"d":"M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],
  list: [["path",{"d":"M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"}]],
  play: [["path",{"d":"m6 3 14 9-14 9z"}]],
  pause: [["rect",{"x":"6","y":"4","width":"4","height":"16"}],["rect",{"x":"14","y":"4","width":"4","height":"16"}]],
  image: [["rect",{"x":"3","y":"3","width":"18","height":"18","rx":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"}]],
  video: [["path",{"d":"m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11"}],["rect",{"x":"2","y":"6","width":"14","height":"12","rx":"2"}]],
  star: [["polygon",{"points":"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"}]],
  phone: [["path",{"d":"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"}]],
  msg: [["path",{"d":"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"}]],
  megaphone: [["path",{"d":"m3 11 18-5v12L3 14v-3z"}],["path",{"d":"M11.6 16.8a3 3 0 1 1-5.8-1.6"}]],
  external: [["path",{"d":"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"}],["path",{"d":"M15 3h6v6"}],["path",{"d":"M10 14 21 3"}]],
  clip: [["path",{"d":"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"}]],
  repeat: [["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],
  shield: [["path",{"d":"M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"}]],
  // Added (not in the prototype's ICONS, which draws its dropdown arrow another way): the category dropdown arrow.
  chevronDown: [["path",{"d":"m6 9 6 6 6-6"}]],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof iconShapes;
