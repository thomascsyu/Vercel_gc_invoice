import { ReactNode, useCallback, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  FileSignature,
  CreditCard,
  Receipt,
  ReceiptText,
  Menu,
  LayoutTemplate,
  UserCog,
  Briefcase,
  Repeat,
  Settings,
  Sun,
  Moon,
  LogOut,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  ListOrdered,
  AlertTriangle,
  GripVertical,
  ChartNoAxesColumnIncreasing,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthSession } from "@/context/auth-session";
import { useTheme } from "@/components/theme-provider";
import { apiUrl } from "@/lib/api-base";
import { queryClient } from "@/lib/queryClient";
import { NavCommandPalette } from "@/components/nav-command";
import {
  CONSULTANTS_PERFORMANCE_HREF,
  CONSULTANTS_SETTINGS_HREF,
  consultantParentHref,
  isConsultantNavHref,
  orderMainNavForMobile,
} from "@/lib/main-nav";

import type { LucideIcon } from "lucide-react";
type NavItem = { name: string; href: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[]; adminOnly?: boolean };
type NavVariant = "desktop" | "mobile";

const MAIN_NAV_ORDER_KEY = "invoiceplane-main-nav-order";
const SIDEBAR_COLLAPSED_KEY = "invoiceplane-sidebar-collapsed";

const mainNavItems: NavItem[] = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Clients", href: "/clients", icon: Users },
  { name: "Consultants", href: CONSULTANTS_SETTINGS_HREF, icon: UserCog },
  { name: "Quotations", href: "/quotations", icon: FileSignature },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Job Orders", href: "/job-orders", icon: Briefcase },
  { name: "Payments", href: "/payments", icon: CreditCard },
  { name: "Receipts", href: "/receipts", icon: ReceiptText },
  { name: "Document layouts", href: "/document-layouts", icon: LayoutTemplate },
  { name: "Recurring Invoices", href: "/recurring-invoices", icon: Repeat },
];

const adminNavGroup: NavGroup = {
  label: "Admin",
  adminOnly: true,
  items: [{ name: "Admin", href: "/admin", icon: Settings }],
};

function defaultMainOrder(): string[] {
  return mainNavItems.map((i) => i.href);
}

function readSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (raw === null) return false;
    return raw === "true";
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore quota / private mode
  }
}

/** Merge stored order with current routes: keep relative order, append new hrefs. */
function normalizeMainOrder(stored: unknown): string[] {
  const canonical = defaultMainOrder();
  const known = new Set(canonical);
  if (!Array.isArray(stored)) return canonical;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of stored) {
    const normalizedHref = h === "/consultants" ? CONSULTANTS_SETTINGS_HREF : h;
    if (
      typeof normalizedHref === "string" &&
      known.has(normalizedHref) &&
      !seen.has(normalizedHref)
    ) {
      out.push(normalizedHref);
      seen.add(normalizedHref);
    }
  }
  for (const h of canonical) {
    if (!seen.has(h)) out.push(h);
  }
  return out;
}

function readInitialMainOrder(): string[] {
  try {
    const raw = localStorage.getItem(MAIN_NAV_ORDER_KEY);
    if (!raw) return defaultMainOrder();
    return normalizeMainOrder(JSON.parse(raw));
  } catch {
    return defaultMainOrder();
  }
}

/** Current section title for mobile header (matches sidebar labels). */
function titleForPath(path: string): string {
  if (path === CONSULTANTS_PERFORMANCE_HREF) return "Consultant performance";
  const main = mainNavItems.find(
    (i) => path === i.href || path.startsWith(`${i.href}/`),
  );
  if (main) return main.name;
  if (path.startsWith("/admin")) return "Admin";
  return "GC-INV";
}

function NavLinks({
  isAdmin,
  location,
  mainOrderHrefs,
  onMoveMainItem,
  onReorderMainItem,
  collapsed,
  reorderMode,
  variant = "desktop",
}: {
  isAdmin: boolean;
  location: string;
  mainOrderHrefs: string[];
  onMoveMainItem: (index: number, direction: "up" | "down") => void;
  onReorderMainItem: (fromHref: string, toHref: string) => void;
  collapsed?: boolean;
  reorderMode: boolean;
  variant?: NavVariant;
}) {
  const [draggedHref, setDraggedHref] = useState<string | null>(null);
  const [dropTargetHref, setDropTargetHref] = useState<string | null>(null);
  const isMobileNav = variant === "mobile";
  const mainByHref = new Map(mainNavItems.map((i) => [i.href, i]));
  const orderedMain = isMobileNav
    ? orderMainNavForMobile(mainNavItems)
    : mainOrderHrefs
        .map((h) => mainByHref.get(h))
        .filter((item): item is NavItem => item != null);

  const groups: NavGroup[] = [
    { label: "Main", items: orderedMain },
    adminNavGroup,
  ];

  if (collapsed) {
    // Collapsed view: icon-only with tooltips
    return (
      <nav className="flex-1 py-4">
        <TooltipProvider delayDuration={0}>
          <div className="space-y-1">
            {groups
              .filter((group) => !group.adminOnly || isAdmin)
              .flatMap((group) => group.items)
              .map((item) => {
                const itemHref = isConsultantNavHref(item.href)
                  ? consultantParentHref(variant)
                  : item.href;
                const isActive = isConsultantNavHref(item.href)
                  ? location.startsWith("/consultants")
                  : location === item.href ||
                    location.startsWith(`${item.href}/`);
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                        href={itemHref}
                        className={cn(
                          "group flex items-center justify-center px-2 py-3 mx-2 rounded-md transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <item.icon
                          className="h-5 w-5 flex-shrink-0"
                          aria-hidden="true"
                        />
                        <span className="sr-only">{item.name}</span>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.name}</TooltipContent>
                  </Tooltip>
                );
              })}
          </div>
        </TooltipProvider>
      </nav>
    );
  }

  // Expanded view: full with move buttons
  return (
    <nav className="flex-1 space-y-4 px-2 py-4">
      {groups
        .filter((group) => !group.adminOnly || isAdmin)
        .map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            {group.label === "Main" && reorderMode ? (
              <p
                className="px-2 pb-2 text-xs text-muted-foreground"
                role="status"
              >
                Drag items into position, or use the arrow buttons.
              </p>
            ) : null}
            <div className="space-y-1">
              {group.items.map((item, index) => {
                const itemHref = isConsultantNavHref(item.href)
                  ? consultantParentHref(variant)
                  : item.href;
                const isActive = isConsultantNavHref(item.href)
                  ? location.startsWith("/consultants")
                  : location === item.href ||
                    location.startsWith(`${item.href}/`);
                const isMain = group.label === "Main";
                return (
                  <div key={item.href} className="space-y-1">
                    <div
                      draggable={isMain && reorderMode}
                      onDragStart={(event) => {
                        if (!isMain || !reorderMode) return;
                        setDraggedHref(item.href);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", item.href);
                      }}
                      onDragOver={(event) => {
                        if (!isMain || !reorderMode) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (draggedHref !== item.href)
                          setDropTargetHref(item.href);
                      }}
                      onDragLeave={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node,
                          )
                        ) {
                          setDropTargetHref((current) =>
                            current === item.href ? null : current,
                          );
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const fromHref =
                          event.dataTransfer.getData("text/plain") ||
                          draggedHref;
                        if (fromHref && fromHref !== item.href)
                          onReorderMainItem(fromHref, item.href);
                        setDraggedHref(null);
                        setDropTargetHref(null);
                      }}
                      onDragEnd={() => {
                        setDraggedHref(null);
                        setDropTargetHref(null);
                      }}
                      className={cn(
                        "flex items-center gap-0 rounded-md transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                        draggedHref === item.href && "scale-[0.98] opacity-50",
                        dropTargetHref === item.href &&
                          "ring-2 ring-primary ring-offset-2 ring-offset-card",
                        isMain &&
                          reorderMode &&
                          "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      {isMain && reorderMode ? (
                        <GripVertical
                          className="ml-1 h-4 w-4 shrink-0 opacity-60"
                          aria-hidden
                        />
                      ) : null}
                      <Link
                        href={itemHref}
                        onClick={(event) => {
                          if (reorderMode) event.preventDefault();
                        }}
                        className={cn(
                          "group flex min-w-0 flex-1 items-center px-2 py-2 text-sm font-medium rounded-md transition-colors",
                          !isActive &&
                            "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <item.icon
                          className={cn(
                            "mr-3 flex-shrink-0 h-5 w-5",
                            isActive
                              ? "text-primary-foreground"
                              : "text-muted-foreground group-hover:text-foreground",
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.name}</span>
                      </Link>
                      {isMain && reorderMode ? (
                        <div
                          className={cn(
                            "flex shrink-0 pr-1",
                            isActive
                              ? "text-primary-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-8 w-8",
                              isActive &&
                                "hover:bg-primary-foreground/15 hover:text-primary-foreground",
                            )}
                            disabled={index === 0}
                            aria-label={`Move ${item.name} up`}
                            onClick={() => onMoveMainItem(index, "up")}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-8 w-8",
                              isActive &&
                                "hover:bg-primary-foreground/15 hover:text-primary-foreground",
                            )}
                            disabled={index === group.items.length - 1}
                            aria-label={`Move ${item.name} down`}
                            onClick={() => onMoveMainItem(index, "down")}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {isConsultantNavHref(item.href) && !reorderMode ? (
                      <div className="ml-7 mt-1 space-y-1 border-l pl-3">
                        {!isMobileNav ? (
                          <Link
                            href={CONSULTANTS_SETTINGS_HREF}
                            className={cn(
                              "block rounded px-2 py-1.5 text-xs font-medium transition-colors",
                              location === CONSULTANTS_SETTINGS_HREF
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            Settings
                            <span className="mt-0.5 block font-normal opacity-70">
                              Consultant registrations
                            </span>
                          </Link>
                        ) : null}
                        <Link
                          href={CONSULTANTS_PERFORMANCE_HREF}
                          className={cn(
                            "flex items-start gap-2 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                            location === CONSULTANTS_PERFORMANCE_HREF
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <ChartNoAxesColumnIncreasing
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                          <span>
                            Performance
                            <span className="mt-0.5 block font-normal opacity-70">
                              Monthly revenue
                            </span>
                          </span>
                        </Link>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mainOrderHrefs, setMainOrderHrefs] = useState<string[]>(() =>
    readInitialMainOrder(),
  );
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readSidebarCollapsed(),
  );
  const [navReorderOpen, setNavReorderOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const toggleSidebar = useCallback(() => {
    const newState = !collapsed;
    setCollapsed(newState);
    saveSidebarCollapsed(newState);
  }, [collapsed]);

  const moveMainItem = useCallback(
    (index: number, direction: "up" | "down") => {
      setMainOrderHrefs((prev) => {
        const next = [...prev];
        const j = direction === "up" ? index - 1 : index + 1;
        if (j < 0 || j >= next.length) return prev;
        [next[index], next[j]] = [next[j], next[index]];
        try {
          localStorage.setItem(MAIN_NAV_ORDER_KEY, JSON.stringify(next));
        } catch {
          // ignore quota / private mode
        }
        return next;
      });
    },
    [],
  );

  const reorderMainItem = useCallback((fromHref: string, toHref: string) => {
    setMainOrderHrefs((prev) => {
      const from = prev.indexOf(fromHref);
      const to = prev.indexOf(toHref);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      try {
        localStorage.setItem(MAIN_NAV_ORDER_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }, []);

  const { data: me } = useAuthSession();
  const isAdmin = me?.role === "admin";
  const displayName = me?.fullName || me?.email || "User";
  const displayEmail = me?.email || "";
  const initial = (
    me?.fullName?.charAt(0) ??
    displayName.charAt(0) ??
    displayEmail.charAt(0) ??
    "?"
  ).toUpperCase();
  const { theme, toggle: toggleTheme } = useTheme();
  const ThemeIcon = theme === "dark" ? Sun : Moon;

  const mobilePageTitle = useMemo(() => titleForPath(location), [location]);

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);

    try {
      // Stop authenticated requests before revoking the refresh token. Otherwise a request
      // already handling a 401 can refresh the cookie while logout is in progress.
      await queryClient.cancelQueries();
      await fetch(apiUrl("/auth/logout"), {
        method: "POST",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
    } catch {
      // Still clear client state and redirect: user expects to leave the app even if the
      // network failed before the server cleared the session cookie.
    }
    queryClient.clear();
    // A full navigation guarantees that no in-memory session result can send the user back
    // to the dashboard, even when the logout request completed during a route transition.
    window.location.assign("/login");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      <a href="#main-content" className="skip-to-main focus-visible:z-[100]">
        Skip to main content
      </a>
      <NavCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        isAdmin={!!isAdmin}
      />
      {/* Mobile Header */}
      <div className="md:hidden border-b bg-card px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Receipt className="h-6 w-6 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <span className="font-bold block leading-tight">GC-INV</span>
            <span className="text-xs text-muted-foreground truncate block">
              {mobilePageTitle}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => setCommandOpen(true)}
            aria-label="Search or jump to page"
            title="Jump to page (Ctrl+K)"
          >
            <Search className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            data-testid="button-theme-toggle-mobile"
          >
            <ThemeIcon className="h-5 w-5" />
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 flex flex-col">
              <SheetTitle className="sr-only">Main menu</SheetTitle>
              <div className="h-16 flex items-center px-4 border-b">
                <Receipt className="h-6 w-6 text-primary mr-2" aria-hidden />
                <span className="text-lg font-bold">GC-INV</span>
              </div>
              <NavLinks
                isAdmin={isAdmin}
                location={location}
                mainOrderHrefs={mainOrderHrefs}
                onMoveMainItem={moveMainItem}
                onReorderMainItem={reorderMainItem}
                reorderMode={false}
                variant="mobile"
              />
              <div className="border-t p-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {initial}
                  </div>
                  <div className="flex-1 truncate">
                    <p className="text-sm font-medium truncate">
                      {displayName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {me?.role ? `${me.role} · ` : ""}
                      {displayEmail}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3 text-muted-foreground hover:text-foreground"
                  onClick={handleLogout}
                  disabled={isSigningOut}
                  aria-busy={isSigningOut}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  {isSigningOut ? "Signing out…" : "Sign out"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <div
        className={cn(
          "hidden md:flex md:flex-col border-r bg-card h-screen sticky top-0 transition-all duration-300 ease-in-out",
          collapsed ? "md:w-16" : "md:w-64",
        )}
      >
        <div className="flex flex-col flex-grow pt-5 overflow-y-auto">
          <div
            className={cn(
              "flex items-center flex-shrink-0 px-2 gap-1",
              collapsed ? "flex-col" : "justify-between px-4",
            )}
          >
            <div
              className={cn(
                "flex items-center min-w-0",
                collapsed ? "flex-col gap-2 w-full" : "flex-1",
              )}
            >
              {!collapsed ? (
                <>
                  <Receipt
                    className="h-8 w-8 text-primary mr-2 shrink-0"
                    aria-hidden
                  />
                  <span className="text-xl font-bold tracking-tight truncate">
                    GC-INV
                  </span>
                </>
              ) : (
                <Receipt
                  className="h-8 w-8 text-primary shrink-0"
                  aria-hidden
                />
              )}
            </div>
            <div
              className={cn(
                "flex items-center gap-1 shrink-0",
                collapsed && "flex-col",
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8 shrink-0", collapsed && "hidden")}
                type="button"
                onClick={() => setNavReorderOpen((v) => !v)}
                aria-pressed={navReorderOpen}
                aria-label={
                  navReorderOpen ? "Done reordering menu" : "Reorder menu items"
                }
                title={navReorderOpen ? "Done reordering" : "Reorder menu"}
              >
                <ListOrdered className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={toggleSidebar}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <ChevronRight className="h-5 w-5" />
                ) : (
                  <ChevronLeft className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
          <div
            className={cn(
              "flex-grow flex flex-col",
              collapsed ? "mt-4" : "mt-6",
            )}
          >
            <NavLinks
              isAdmin={isAdmin}
              location={location}
              mainOrderHrefs={mainOrderHrefs}
              onMoveMainItem={moveMainItem}
              onReorderMainItem={reorderMainItem}
              collapsed={collapsed}
              reorderMode={navReorderOpen}
            />
          </div>
        </div>
        <div className={cn("border-t", collapsed ? "p-2" : "p-4")}>
          {!collapsed ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shadow-sm">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {me?.role ? `${me.role} · ` : ""}
                    {displayEmail}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                className="w-full justify-start text-muted-foreground hover:text-foreground mb-2"
                onClick={toggleTheme}
                data-testid="button-theme-toggle"
              >
                <ThemeIcon className="h-4 w-4 mr-2" />
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start text-muted-foreground hover:text-foreground"
                onClick={handleLogout}
                disabled={isSigningOut}
                aria-busy={isSigningOut}
              >
                <LogOut className="h-4 w-4 mr-2" />
                {isSigningOut ? "Signing out…" : "Sign out"}
              </Button>
            </>
          ) : (
            <TooltipProvider delayDuration={0}>
              <div className="flex flex-col items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shadow-sm cursor-default">
                      {initial}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="font-medium">{displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {displayEmail}
                    </p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={toggleTheme}
                      aria-label={
                        theme === "dark"
                          ? "Switch to light mode"
                          : "Switch to dark mode"
                      }
                      data-testid="button-theme-toggle"
                    >
                      <ThemeIcon className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {theme === "dark" ? "Light mode" : "Dark mode"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-foreground"
                      onClick={handleLogout}
                      disabled={isSigningOut}
                      aria-busy={isSigningOut}
                      aria-label="Sign out"
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Sign out</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )}
        </div>
      </div>

      {/* Main Content */}
      {me?.testModeEnabled ? (
        <div
          role="status"
          className="border-b border-amber-600/40 bg-amber-500 text-amber-950"
          data-testid="test-mode-banner"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              TEST MODE — sandbox data only. Live clients, invoices, quotations,
              payments, receipts, and job orders are unaffected.
            </span>
            {isAdmin ? (
              <button
                type="button"
                className="underline underline-offset-2 ml-auto"
                onClick={() => setLocation("/admin?tab=test-mode")}
              >
                Manage
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 bg-muted/20 outline-none"
      >
        <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
