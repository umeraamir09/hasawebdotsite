import dispatcher from "./publication-dispatch-worker";
export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
  queue: dispatcher.queue,
  scheduled: dispatcher.scheduled,
};
