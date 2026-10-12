export class ToolMessage {
  [key: string]: unknown;
  constructor(fields: Record<string, unknown>) {
    Object.assign(this, fields);
  }
}
