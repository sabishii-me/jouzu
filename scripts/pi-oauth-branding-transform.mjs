// The same two-row braille wordmark and cyan-to-pink palette used by Jouzu.
const mark = ["⠈⢹ ⡎⢱ ⡇⢸ ⢉⠝ ⡇⢸", "⠣⠜ ⠣⠜ ⠣⠜ ⠮⠤ ⠣⠜"];
const dots = [
	[0, 0],
	[0, 1],
	[0, 2],
	[1, 0],
	[1, 1],
	[1, 2],
	[0, 3],
	[1, 3],
];

function logoSvg() {
	const circles = [];
	for (const [row, line] of mark.entries()) {
		let column = 0;
		let x = 0;
		for (const character of line) {
			if (character === " ") {
				x += 1.5;
				continue;
			}
			const color = [34, 211, 238].map((start, channel) =>
				Math.round(start + (([244, 114, 182][channel] - start) * column) / 9),
			);
			const bits = character.codePointAt(0) - 0x2800;
			for (const [bit, [dx, dy]] of dots.entries()) {
				if (bits & (1 << bit))
					circles.push(`<circle cx="${x + dx}" cy="${row * 4 + dy}" r="0.36" fill="rgb(${color.join(" ")})"/>`);
			}
			x += 2;
			column++;
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.36 -0.36 25.72 7.72" role="img" aria-label="Jouzu">${circles.join("")}</svg>`;
}

export function transformOAuthBranding(source) {
	const replace = (before, after) => {
		const parts = source.split(before);
		if (parts.length !== 2) throw new Error("OAuth page branding source anchor changed");
		source = parts.join(after);
	};
	const logo = source.match(/^const LOGO_SVG = .*;$/m)?.[0];
	if (!logo) throw new Error("OAuth page logo source anchor changed");
	replace(logo, `const LOGO_SVG = \`${logoSvg()}\`;`);
	replace("--page-bg: #09090b;", "--page-bg: #1a1b26;");
	replace("--text: #fafafa;", "--text: #c0caf5;");
	replace("--text-dim: #a1a1aa;", "--text-dim: #a9b1d6;");
	replace("width: 72px;\n      height: 72px;", "width: min(100%, 352px);\n      height: auto;");
	replace("    h1 {", "    .logo svg { display: block; width: 100%; height: auto; }\n    h1 {");
	return source;
}
