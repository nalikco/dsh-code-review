// Agent/setup contexts belong to the agent-loop fiber, not this plugin's
// injection declaration. get() resolves the active service in that context's
// isolation realm and preserves its scoped receiver without borrowing inject.
export function service(context, name) {
  const value = context.get(name);
  if (value === undefined) throw new Error(`Code review requires active service "${name}" in the agent context.`);
  return value;
}
