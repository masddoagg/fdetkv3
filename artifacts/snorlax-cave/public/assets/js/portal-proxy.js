let frame = document.getElementById("siteurl");
const status = document.getElementById("proxy-status");
let proxyNavigationStarted = false;

function showError(error) {
  status.replaceChildren();

  const title = document.createElement("strong");
  title.textContent = "The proxy could not start.";

  const detail = document.createElement("span");
  detail.textContent = error instanceof Error ? error.message : String(error);

  const home = document.createElement("a");
  home.href = "/";
  home.textContent = "Return to Snorlax's Cave";

  status.append(title, detail, home);
  status.hidden = false;
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(script);
  });
}

async function ensureUvConfig() {
  if (window.__uv$config?.encodeUrl && window.__uv$config?.decodeUrl) return;
  await loadClassicScript("/uv/uv.bundle.js");
  await loadClassicScript("/uv/uv.config.js");

  if (!window.__uv$config?.encodeUrl || !window.__uv$config?.decodeUrl) {
    throw new Error("UV configuration did not load");
  }
}

async function getTargetUrl(engine) {
  const storedTarget = localStorage.getItem("proxyTargetUrl");
  if (storedTarget) return new URL(storedTarget).href;

  const legacyEncodedUrl = localStorage.getItem("encodedUrl");
  if (!legacyEncodedUrl) return "";

  await ensureUvConfig();
  const decoded = window.__uv$config.decodeUrl(legacyEncodedUrl);
  const target = new URL(decoded);
  if (engine === "scramjet") localStorage.setItem("proxyTargetUrl", target.href);
  return target.href;
}

async function startUltraviolet(targetUrl) {
  await ensureUvConfig();

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: window.__uv$config.prefix,
    updateViaCache: "none",
  });
  await window.waitForActiveServiceWorker(registration);

  frame.src = window.__uv$config.prefix + window.__uv$config.encodeUrl(targetUrl);
  proxyNavigationStarted = true;
}

async function startScramjet(targetUrl) {
  await Promise.all([
    loadClassicScript("/scramjet/scramjet.all.js"),
    loadClassicScript("/baremux/index.js"),
  ]);

  const { ScramjetController } = window.$scramjetLoadController();
  const controller = new ScramjetController({
    prefix: "/scramjet-proxy/",
    files: {
      wasm: "/scramjet/scramjet.wasm.wasm",
      all: "/scramjet/scramjet.all.js",
      sync: "/scramjet/scramjet.sync.js",
    },
  });
  await controller.init();

  const registration = await navigator.serviceWorker.register("/scramjet-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  const serviceWorker = await window.waitForActiveServiceWorker(registration);
  if (!serviceWorker) throw new Error("Scramjet service worker did not activate");

  const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
  const connection = new window.BareMux.BareMuxConnection("/baremux/worker.js");
  window.__bareMuxConnection = connection;
  await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);

  window.__scramjetController = controller;
  const proxyFrame = controller.createFrame(frame);
  window.__scramjetFrame = proxyFrame;
  proxyFrame.go(targetUrl);
  proxyNavigationStarted = true;
}

function handleFrameLoad() {
  if (proxyNavigationStarted) status.hidden = true;
}

frame.addEventListener("load", handleFrameLoad);

async function startPortal() {
  if (!frame || !status) throw new Error("Proxy page elements are missing");
  const engine = localStorage.getItem("proxyEngine") === "scramjet" ? "scramjet" : "uv";
  const targetUrl = await getTargetUrl(engine);

  if (!targetUrl) {
    window.location.replace("/");
    return;
  }

  const target = new URL(targetUrl);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites can be opened in the proxy");
  }

  if (isYouTubeVideoUrl(target.href)) {
    window.location.replace(getYouTubePlayerPageUrl(target.href));
    return;
  }

  if (engine === "scramjet") {
    await startScramjet(target.href);
  } else {
    await startUltraviolet(target.href);
  }
}

startPortal().catch((error) => {
  console.error("Unable to start the selected proxy engine:", error);
  showError(error);
});
