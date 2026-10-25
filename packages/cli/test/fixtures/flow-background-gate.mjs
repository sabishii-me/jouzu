import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { afterFlowCleanup } from "./flow-assembly.mjs";

export async function controlledBackground(t) {
	const token = randomUUID();
	const sockets = new Set();
	const errors = [];
	let released = false;
	let resolveStarted;
	const started = new Promise((resolve) => {
		resolveStarted = resolve;
	});
	const finish = (socket) => {
		if (!socket.writableEnded) socket.end("release\n");
	};
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		socket.on("error", (error) => {
			// A producer can terminate the child before fixture cleanup.
			if (error.code !== "ECONNRESET") errors.push(error);
		});
		let input = "";
		socket.on("data", (data) => {
			input += data;
			if (!input.includes("\n")) return;
			const [identity, pid] = input.trim().split(" ");
			if (identity !== token || !/^[1-9][0-9]*$/.test(pid)) {
				errors.push(new Error("Background fixture received an invalid child identity."));
				socket.destroy();
				return;
			}
			resolveStarted(Number(pid));
			if (released) finish(socket);
		});
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const release = async () => {
		released = true;
		for (const socket of sockets) finish(socket);
	};
	let closing;
	const close = () => {
		closing ??= (async () => {
			// Stop accepting children, release any survivor, and join its connection before callers
			// remove the session directory. Deleting a release file cannot stop an orphan on Windows.
			const closed = new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			await release();
			await closed;
			if (errors.length) throw new AggregateError(errors, "Background fixture cleanup failed");
		})();
		return closing;
	};
	afterFlowCleanup(t, close);
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	const script =
		"const net=require('node:net');const socket=net.connect(Number(process.argv[1]),'127.0.0.1',()=>socket.write(process.argv[2]+' '+process.pid+'\\n'));" +
		"socket.on('data',()=>{console.log('finished');process.exit(0)});socket.on('end',()=>process.exit(0));socket.on('error',error=>{console.error(error);process.exit(1)});";
	return {
		command: `node -e ${quote(script)} ${server.address().port} ${quote(token)}`,
		started,
		release,
		close,
	};
}
