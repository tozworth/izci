// Keep optional titlebar content out of the native controls' space. Measure
// intrinsic widths even while culled, so resizing back never oscillates.
export function fitDesktopTitlebar(controls: HTMLElement) {
  const bar = controls.closest<HTMLElement>('.menu-bar');
  if (!bar) return;

  function measure(): void {
    if (!bar) return;
    const menu = bar.querySelector<HTMLElement>('.compact-menu-trigger, .menu-groups');
    const brand = bar.querySelector<HTMLElement>('.menu-brand');
    const mini = controls.querySelector<HTMLElement>('.mini-player-control');
    const menuWidth = menu?.getBoundingClientRect().width ?? 0;
    const buttons = Array.from(controls.children) as HTMLElement[];
    const controlsWidth = buttons.reduce((width, button) =>
      width + Number.parseFloat(getComputedStyle(button).width), 0);
    const brandChildren = brand ? Array.from(brand.children) as HTMLElement[] : [];
    const brandWidth = brandChildren.reduce((width, child) =>
      width + child.getBoundingClientRect().width, 0)
      + Math.max(0, brandChildren.length - 1) * Number.parseFloat(brand ? getComputedStyle(brand).columnGap : '0');

    bar.classList.toggle('desktop-titlebar-hide-brand', menuWidth + controlsWidth + brandWidth > bar.clientWidth);
    bar.classList.toggle('desktop-titlebar-hide-mini', mini !== null && menuWidth + controlsWidth > bar.clientWidth);
  }

  const resize = new ResizeObserver(measure);
  function observeContent(): void {
    resize.disconnect();
    resize.observe(bar!);
    for (const element of bar!.querySelectorAll<HTMLElement>(
      '.compact-menu-trigger, .menu-groups, .menu-brand > *, .desktop-window-controls > button'
    )) resize.observe(element);
    measure();
  }
  // Menu mode, translated text, subtitle and mini-player availability can all
  // change independently of the window size.
  const mutation = new MutationObserver(observeContent);
  mutation.observe(bar, { childList: true, characterData: true, subtree: true });
  observeContent();

  return {
    destroy() {
      resize.disconnect();
      mutation.disconnect();
      bar.classList.remove('desktop-titlebar-hide-brand', 'desktop-titlebar-hide-mini');
    }
  };
}
