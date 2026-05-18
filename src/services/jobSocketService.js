import { io } from "socket.io-client";
import { getApiBaseUrl } from "./api";
import { getToken } from "./authApi";

let socket;
const subscribers = new Map();

async function getSocket() {
  if (socket?.connected) return socket;

  const token = await getToken();
  socket = io(getApiBaseUrl(), {
    transports: ["websocket"],
    auth: token ? { token } : {},
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  socket.on("job:update", (update) => {
    const jobSubscribers = subscribers.get(String(update.jobId));
    if (!jobSubscribers) return;
    jobSubscribers.forEach((listener) => listener(update));
  });

  return socket;
}

export async function subscribeToJob(jobId, listener) {
  const id = String(jobId);
  const activeSocket = await getSocket();
  const jobSubscribers = subscribers.get(id) || new Set();
  jobSubscribers.add(listener);
  subscribers.set(id, jobSubscribers);
  activeSocket.emit("job:subscribe", id);

  return () => {
    const current = subscribers.get(id);
    if (!current) return;
    current.delete(listener);
    if (!current.size) {
      subscribers.delete(id);
      activeSocket.emit("job:unsubscribe", id);
    }
  };
}

export function disconnectJobSocket() {
  socket?.disconnect();
  socket = null;
  subscribers.clear();
}
