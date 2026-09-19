"use client";

// Isolated interface for triggering analytics exports (CSV/PDF/email).
//
// STATUS: NOT CONNECTED TO A BACKEND.
//
// The verified admin-analytics contract is GET-only (dashboard data); it
// has no create/list export-job action. analytics_export_jobs exists as a
// table, but browser clients must never write to it directly -- only a
// server-side function should, once one exists, so it can validate the
// request and enforce access the same way admin-analytics does for reads.
//
// This file is the ONLY place ExportsClient.tsx talks to for exports. When
// a real export Edge Function is deployed, implement createExportJob /
// listExportJobs here to call it -- nothing in the UI should need to
// change, since it only depends on this interface.

import type { CreateExportJobInput, ExportJob } from "./types";

export class ExportNotConnectedError extends Error {
  constructor() {
    super("Export generation isn't connected to a backend yet.");
    this.name = "ExportNotConnectedError";
  }
}

export interface ExportClient {
  createExportJob(input: CreateExportJobInput): Promise<ExportJob>;
  listExportJobs(): Promise<ExportJob[]>;
}

export const exportClient: ExportClient = {
  async createExportJob(): Promise<ExportJob> {
    throw new ExportNotConnectedError();
  },
  async listExportJobs(): Promise<ExportJob[]> {
    throw new ExportNotConnectedError();
  },
};
