// The `.design/config.json` of a throwaway project a studio will open. The studio opens a project with no
// `formatVersion` (format 1) view only (2A, FORMAT_GATE_OPTS): its writes are refused, a sync pull included. Every
// harness that serves a project it built itself stamps the format through here.
export const FORMAT_V2 = 2;
export const v2Config = (config) => ({ ...config, formatVersion: FORMAT_V2 });
