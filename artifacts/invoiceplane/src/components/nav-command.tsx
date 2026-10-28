import { useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  FileSignature,
  CreditCard,
  ReceiptText,
  LayoutTemplate,
  UserCog,
  Briefcase,
  Repeat,
  Settings,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type NavEntry = { label: string; href: string; keywords?: string };

const MAIN_NAV: NavEntry[] = [
  { label: "Dashboard", href: "/dashboard", keywords: "overview home" },
  { label: "Clients", href: "/clients", keywords: "customers" },
  {
    label: "Consultant settings",
    href: "/consultants/settings",
    keywords: "consultants registrations",
  },
  {
    label: "Consultant performance",
    href: "/consultants/performance",
    keywords: "consultants monthly revenue",
  },
  { label: "Quotations", href: "/quotations", keywords: "quotes estimates" },
  { label: "Invoices", href: "/invoices", keywords: "billing" },
  { label: "Job Orders", href: "/job-orders", keywords: "jobs work orders" },
  { label: "Payments", href: "/payments" },
  { label: "Receipts", href: "/receipts" },
  {
    label: "Document layouts",
    href: "/document-layouts",
    keywords: "pdf templates",
  },
  {
    label: "Recurring Invoices",
    href: "/recurring-invoices",
    keywords: "subscription repeat",
  },
];

const ADMIN_NAV: NavEntry[] = [
  { label: "Admin", href: "/admin", keywords: "settings users keys company" },
];

const iconFor = (href: string) => {
  const map: Record<string, typeof LayoutDashboard> = {
    "/dashboard": LayoutDashboard,
    "/clients": Users,
    "/consultants/settings": UserCog,
    "/consultants/performance": UserCog,
    "/quotations": FileSignature,
    "/invoices": FileText,
    "/job-orders": Briefcase,
    "/payments": CreditCard,
    "/receipts": ReceiptText,
    "/document-layouts": LayoutTemplate,
    "/recurring-invoices": Repeat,
    "/admin": Settings,
  };
  return map[href] ?? LayoutDashboard;
};

export function NavCommandPalette({
  open,
  onOpenChange,
  isAdmin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
}) {
  const [, navigate] = useLocation();

  const groups = useMemo(() => {
    const admin = isAdmin ? ADMIN_NAV : [];
    return [
      { heading: "Navigation", items: MAIN_NAV },
      { heading: "Admin", items: admin },
    ];
  }, [isAdmin]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onOpenChange]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to page…" />
      <CommandList>
        <CommandEmpty>No pages match.</CommandEmpty>
        {groups.map((g) =>
          g.items.length === 0 ? null : (
            <CommandGroup key={g.heading} heading={g.heading}>
              {g.items.map((item) => {
                const Icon = iconFor(item.href);
                return (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${item.href} ${item.keywords ?? ""}`}
                    onSelect={() => {
                      navigate(item.href);
                      onOpenChange(false);
                    }}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ),
        )}
        <CommandSeparator />
        <CommandGroup heading="Shortcuts">
          <CommandItem disabled value="shortcut-hint">
            Press Ctrl+K or ⌘K to open this palette
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
