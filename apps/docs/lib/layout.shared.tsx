import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  const webOrigin =
    process.env.NEXT_PUBLIC_WEB_ORIGIN ??
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://os.agentcommons.io");

  return {
    nav: {
      title: (
        <span className="cos-logo">
          Common<span>OS</span>
        </span>
      ),
    },
    links: [
      {
        text: "World UI",
        url: `${webOrigin}/world`,
      },
      {
        text: "Dashboard",
        url: `${webOrigin}/dashboard`,
      },
      {
        text: "GitHub",
        url: "https://github.com/Arttribute/common-os",
        external: true,
      },
    ],
  };
}
