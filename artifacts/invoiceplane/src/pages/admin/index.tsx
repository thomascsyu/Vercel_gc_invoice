import { useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import UsersPage from "@/pages/admin/users";
import CompanySettingsPage from "@/pages/admin/company-settings";
import DeepseekSettingsPage from "@/pages/admin/deepseek-settings";
import BackupSettingsPage from "@/pages/admin/backup-settings";
import TestModeSettingsPage from "@/pages/admin/test-mode-settings";
import ApiKeysPage from "@/pages/admin/api-keys";
const ADMIN_TABS = [
  "users",
  "api-keys",
  "deepseek",
  "backup",
  "test-mode",
  "company-info",
  "company-banks",
  "company-branding",
  "email-gmail",
  "email-templates",
] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

function isAdminTab(v: string | null): v is AdminTab {
  return v !== null && (ADMIN_TABS as readonly string[]).includes(v);
}

const TAB_LABELS: Record<AdminTab, string> = {
  users: "Users",
  "api-keys": "API access",
  deepseek: "DeepSeek API key",
  backup: "Backup & roll back",
  "test-mode": "Test mode",
  "company-info": "Company info",
  "company-banks": "Bank accounts",
  "company-branding": "Branding & images",
  "email-gmail": "Email sending (Gmail API)",
  "email-templates": "Email templates",
};

const MENU: { heading: string; tabs: AdminTab[] }[] = [
  {
    heading: "Admin",
    tabs: ["users", "api-keys", "deepseek", "backup", "test-mode"],
  },
  {
    heading: "Company",
    tabs: ["company-info", "company-banks", "company-branding"],
  },
  { heading: "Email", tabs: ["email-gmail", "email-templates"] },
];

function tabFromLegacy(
  initial: string | null,
  gmailParam: string | null,
): AdminTab {
  if (initial === "users") return initial;
  if (initial === "company" || gmailParam)
    return gmailParam ? "email-gmail" : "company-info";
  return "users";
}

export default function AdminPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const gmailParam = params.get("gmail");
  const initial = params.get("tab");
  const tab: AdminTab = isAdminTab(initial)
    ? initial
    : tabFromLegacy(initial, gmailParam);

  useEffect(() => {
    if (!isAdminTab(initial)) {
      const next = new URLSearchParams(search);
      next.set("tab", tab);
      setLocation(`/admin?${next.toString()}`, { replace: true });
    }
    if (gmailParam && tab !== "email-gmail") {
      const next = new URLSearchParams(search);
      next.set("tab", "email-gmail");
      setLocation(`/admin?${next.toString()}`, { replace: true });
    }
  }, [initial, gmailParam, search, setLocation, tab]);

  const onSelectTab = (v: AdminTab) => {
    const next = new URLSearchParams(search);
    next.set("tab", v);
    setLocation(`/admin?${next.toString()}`);
  };

  const title = useMemo(() => TAB_LABELS[tab], [tab]);

  const main = useMemo(() => {
    switch (tab) {
      case "users":
        return <UsersPage />;
      case "api-keys":
        return <ApiKeysPage />;
      case "deepseek":
        return <DeepseekSettingsPage />;
      case "backup":
        return <BackupSettingsPage />;
      case "test-mode":
        return <TestModeSettingsPage />;
      case "company-info":
        return <CompanySettingsPage section="info" />;
      case "company-banks":
        return <CompanySettingsPage section="banks" />;
      case "company-branding":
        return <CompanySettingsPage section="branding" />;
      case "email-gmail":
        return <CompanySettingsPage section="gmail" />;
      case "email-templates":
        return <CompanySettingsPage section="templates" />;
      default:
        return null;
    }
  }, [tab]);

  return (
    <div className="flex flex-col gap-4 min-h-[min(70vh,640px)] lg:flex-row lg:items-start">
      <aside className="w-full shrink-0 lg:w-56 xl:w-64">
        <nav className="rounded-lg border bg-card text-card-foreground">
          <ScrollArea className="max-h-[min(70vh,520px)]">
            <div className="p-2 space-y-4">
              {MENU.map((group) => (
                <div key={group.heading}>
                  <p className="px-2 pb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {group.heading}
                  </p>
                  <ul className="space-y-0.5">
                    {group.tabs.map((id) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => onSelectTab(id)}
                          data-testid={`admin-nav-${id}`}
                          className={cn(
                            "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
                            tab === id
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                          )}
                        >
                          {TAB_LABELS[id]}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ScrollArea>
        </nav>
      </aside>
      <div className="min-w-0 flex-1 space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Administration, company profile, and email configuration.
          </p>
        </div>
        {main}
      </div>
    </div>
  );
}
