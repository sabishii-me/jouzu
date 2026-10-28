// Dialog signals identify individual logins, including reconnects with an existing credential.
const savedLogins = new WeakSet<AbortSignal>();

export function markShisaLoginSaved(signal: AbortSignal | undefined): void {
	if (signal) savedLogins.add(signal);
}

export function wasShisaLoginSaved(signal: AbortSignal): boolean {
	return savedLogins.has(signal);
}
