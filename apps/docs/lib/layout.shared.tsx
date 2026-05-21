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
        url: "/world",
      },
      {
        text: "Dashboard",
        url: "/dashboard",
      },
      {
        text: "GitHub",
        url: "https://github.com/Arttribute/common-os",
        external: true,
      },
    ],
  };
}
