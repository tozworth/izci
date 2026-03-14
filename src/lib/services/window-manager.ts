const OPTIONS_WINDOW_NAME = 'izci-options';
const OPTIONS_WINDOW_FEATURES = ['popup=yes', 'width=720', 'height=520', 'resizable=yes', 'scrollbars=yes'].join(',');

function buildOptionsMarkup(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>izci Options</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
        background: #1d2021;
        color: #ebdbb2;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(184, 187, 38, 0.12), transparent 24%),
          radial-gradient(circle at top right, rgba(250, 189, 47, 0.08), transparent 22%),
          linear-gradient(180deg, #282828 0%, #1d2021 100%);
      }

      main {
        width: min(32rem, calc(100vw - 2rem));
        padding: 2rem;
        border: 1px solid rgba(168, 153, 132, 0.28);
        border-radius: 1rem;
        background: rgba(50, 48, 47, 0.94);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
      }

      p {
        margin: 0.5rem 0 0;
        color: #bdae93;
      }

      .eyebrow {
        color: #d79921;
        font-size: 0.72rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0.25rem 0 0;
        font-size: 1.5rem;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">Options</div>
      <h1>Reserved Surface</h1>
      <p>This popup is intentionally empty for the MVP.</p>
    </main>
  </body>
</html>`;
}

function isOpenWindow(windowRef: Window | null): windowRef is Window {
  return windowRef !== null && !windowRef.closed;
}

let optionsWindowRef: Window | null = null;

export const windowManager = {
  openOptions() {
    const existingWindow = optionsWindowRef;

    if (isOpenWindow(existingWindow)) {
      existingWindow.focus();
      return existingWindow;
    }

    optionsWindowRef = window.open('', OPTIONS_WINDOW_NAME, OPTIONS_WINDOW_FEATURES);

    if (!optionsWindowRef) {
      return null;
    }

    optionsWindowRef.document.open();
    optionsWindowRef.document.write(buildOptionsMarkup());
    optionsWindowRef.document.close();
    optionsWindowRef.focus();

    return optionsWindowRef;
  },
  exit() {
    window.close();

    if (!window.closed) {
      window.location.replace('about:blank');
    }
  }
};
