import { useEffect, useState } from "react";
import { subscribeToJob } from "../services/jobSocketService";

export function useJobSocket(jobId) {
  const [job, setJob] = useState(null);

  useEffect(() => {
    if (!jobId) return undefined;

    let unsubscribe;
    let cancelled = false;

    subscribeToJob(jobId, (update) => {
      if (!cancelled) setJob(update);
    }).then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [jobId]);

  return job;
}
