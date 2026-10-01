"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENU = [
  { href: "/reports", label: "보고서 목록", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { href: "/new", label: "보고서 생성", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" },
];

/**
 * 왼쪽 메뉴 — 목록과 생성 두 화면만 오간다. 예전엔 여기에 저장된 보고서를 줄줄이 나열했는데
 * 보기 힘들다는 지적(2026-09-30)으로 목록은 `/reports` 본문으로 옮겼다.
 */
export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[240px] shrink-0 border-r border-[#e7ecf3] bg-white lg:flex lg:min-h-screen lg:flex-col">
      <Link href="/reports" className="flex items-center gap-3 border-b border-[#eef1f5] px-5 py-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[#1d2433] text-sm font-bold text-white">A</span>
        <span>
          <span className="block text-[15px] font-bold tracking-[-0.02em] text-[#1d2433]">AX Report</span>
          <span className="block text-[11px] text-[#94a0b2]">사용성테스트 보고서 자동화</span>
        </span>
      </Link>
      <nav className="space-y-1 px-3 py-4">
        {MENU.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-[#f0f3f8] font-semibold text-[#1d2433]" : "text-[#4a566b] hover:bg-[#f6f8fb]"}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={item.icon} />
              </svg>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
