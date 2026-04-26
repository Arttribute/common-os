import Link from "next/link";

export default function HomePage() {
	return (
		<main
			style={{
				width: "100vw",
				height: "100vh",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 32,
				background: "#060b14",
				color: "#e2e8f0",
				fontFamily: "monospace",
			}}
		>
			{/* Logo */}
			<div style={{ textAlign: "center" }}>
				<h1
					style={{
						fontSize: 36,
						fontWeight: 700,
						letterSpacing: -1,
						marginBottom: 8,
					}}
				>
					common<span style={{ color: "#f59e0b" }}>os</span>
				</h1>
				<p
					style={{
						fontSize: 12,
						color: "#334155",
						letterSpacing: 2,
						textTransform: "uppercase",
					}}
				>
					persistent AI agent fleets
				</p>
			</div>

			{/* Description */}
			<div
				style={{
					maxWidth: 420,
					textAlign: "center",
					fontSize: 13,
					color: "#475569",
					lineHeight: 1.7,
				}}
			>
				Give every AI agent its own computer. Deploy a fleet with one command.
				Watch them work in a live isometric world.
			</div>

			{/* Three propositions */}
			<div
				style={{
					display: "flex",
					gap: 20,
					flexWrap: "wrap",
					justifyContent: "center",
				}}
			>
				{[
					{
						label: "Fleet Infrastructure",
						desc: "Isolated VMs, one command deploy",
					},
					{ label: "Control Plane", desc: "Task routing, events, permissions" },
					{ label: "World UI", desc: "Agents as live characters in a world" },
				].map((item) => (
					<div
						key={item.label}
						style={{
							padding: "12px 16px",
							background: "rgba(255,255,255,0.03)",
							border: "1px solid rgba(255,255,255,0.06)",
							borderRadius: 8,
							width: 160,
							textAlign: "center",
						}}
					>
						<div
							style={{
								fontSize: 10,
								color: "#f59e0b",
								marginBottom: 4,
								letterSpacing: 0.5,
							}}
						>
							{item.label}
						</div>
						<div style={{ fontSize: 10, color: "#334155" }}>{item.desc}</div>
					</div>
				))}
			</div>

			{/* CTA */}
			<Link
				href="/world"
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 8,
					padding: "11px 28px",
					background: "rgba(245, 158, 11, 0.12)",
					border: "1px solid rgba(245, 158, 11, 0.3)",
					borderRadius: 8,
					color: "#f59e0b",
					fontSize: 12,
					fontFamily: "monospace",
					textDecoration: "none",
					letterSpacing: 0.5,
					transition: "background 0.15s",
				}}
			>
				open world →
			</Link>

			{/* Footer */}
			<div
				style={{
					position: "absolute",
					bottom: 20,
					fontSize: 9,
					color: "#1e293b",
					letterSpacing: 1,
				}}
			>
				Common OS · agent commons hackathon 2026
			</div>
		</main>
	);
}
