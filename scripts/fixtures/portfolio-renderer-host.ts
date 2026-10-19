const frame = document.querySelector("iframe");
if (!frame) throw new Error("Preview iframe is missing");
let model: unknown;
let ready = false;
function send() {
  if (ready && model)
    frame?.contentWindow?.postMessage(
      { channel: "phase16-fixture", revision: 1, model },
      location.origin,
    );
}
window.addEventListener("message", (event) => {
  if (
    event.source === frame.contentWindow &&
    event.origin === location.origin &&
    event.data?.channel === "phase16-ready"
  ) {
    ready = true;
    send();
  }
});
const name = new URL(location.href).searchParams.get("fixture") ?? "complete";
const response = await fetch(
  `/private/model?fixture=${encodeURIComponent(name)}`,
);
if (!response.ok) throw new Error("Private fixture access denied");
model = await response.json();
send();
