import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="cos-logo">
          common<span>os</span>
        </span>
      ),
    },
    links: [
      {
        text: "World UI",
        url: "http://localhost:3000/world",
      },
      {
        text: "Dashboard",
        url: "http://localhost:3000/dashboard",
      },
      {
        text: "GitHub",
        url: "https://github.com/Arttribute/common-os",
        external: true,
      },
    ],
  };
}
