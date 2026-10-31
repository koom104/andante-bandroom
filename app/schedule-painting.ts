export type SchedulePaintCell = { key: string; busy: boolean; locked: boolean; columnIndex: number; time: string };

export function attachScheduleTouchEditing(grid: HTMLElement, readCell: (element: Element) => SchedulePaintCell | null, paint: (cell: SchedulePaintCell, busy: boolean) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gesture: { id: number; x: number; y: number; cell: SchedulePaintCell; busy: boolean; painting: boolean; visited: Set<string> } | null = null;
  const stop = () => { clearTimeout(timer); gesture = null; grid.removeAttribute("data-painting"); };
  const apply = (cell: SchedulePaintCell) => {
    if (!gesture || cell.locked || gesture.visited.has(cell.key)) return;
    gesture.visited.add(cell.key); paint(cell, gesture.busy);
  };
  const start = (event: TouchEvent) => {
    stop();
    if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
    const cell = readCell(event.target);
    if (!cell || cell.locked) return;
    const touch = event.touches[0];
    gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, cell, busy: !cell.busy, painting: false, visited: new Set() };
    // A normal swipe remains native page scrolling; holding starts a paint stroke.
    timer = setTimeout(() => {
      if (!gesture) return;
      gesture.painting = true; grid.setAttribute("data-painting", "true"); apply(gesture.cell);
    }, 220);
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) { stop(); return; }
    const touch = Array.from(event.touches).find((item) => item.identifier === gesture?.id);
    if (!touch) return;
    if (!gesture.painting) {
      if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 8) stop();
      return;
    }
    if (!event.cancelable) { stop(); return; }
    event.preventDefault();
    const element = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!element || !grid.contains(element)) return;
    const cell = readCell(element);
    if (cell) apply(cell);
  };
  const end = (event: TouchEvent) => {
    if (!gesture || !Array.from(event.changedTouches).some((touch) => touch.identifier === gesture?.id)) return;
    if (event.cancelable) event.preventDefault();
    if (!gesture.painting) apply(gesture.cell);
    stop();
  };
  grid.addEventListener("touchstart", start, { passive: true });
  grid.addEventListener("touchmove", move, { passive: false });
  grid.addEventListener("touchend", end, { passive: false });
  grid.addEventListener("touchcancel", stop);
  window.addEventListener("blur", stop);
  return () => {
    stop(); grid.removeEventListener("touchstart", start); grid.removeEventListener("touchmove", move);
    grid.removeEventListener("touchend", end); grid.removeEventListener("touchcancel", stop); window.removeEventListener("blur", stop);
  };
}
