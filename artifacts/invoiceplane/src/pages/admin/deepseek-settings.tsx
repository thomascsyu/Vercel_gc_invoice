import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiGetSettings,
  apiUpdateSettings,
  apiTestDeepseekConnection,
  type CompanySettings,
} from "@/lib/modulesApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PlugZap } from "lucide-react";

const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flashas";

export default function DeepseekSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery({ queryKey: ["/company-settings"], queryFn: apiGetSettings });
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_DEEPSEEK_MODEL);

  useEffect(() => {
    if (data?.deepseekApiKey !== undefined) {
      setApiKey(data.deepseekApiKey ?? "");
    }
    if (data?.deepseekModel !== undefined) {
      setModel(data.deepseekModel?.trim() || DEFAULT_DEEPSEEK_MODEL);
    }
  }, [data?.deepseekApiKey, data?.deepseekModel]);

  const testDeepseekMut = useMutation({
    mutationFn: () => apiTestDeepseekConnection(apiKey.trim() || undefined),
    onSuccess: (r) => {
      if (r.ok && r.message) {
        toast({ title: "DeepSeek OK", description: r.message });
      } else {
        toast({
          title: "DeepSeek failed",
          description: r.error ?? r.detail ?? "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) =>
      toast({ title: "DeepSeek test failed", description: e.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      apiUpdateSettings({
        deepseekApiKey: apiKey.trim() || null,
        deepseekModel: model.trim() || DEFAULT_DEEPSEEK_MODEL,
      } as Partial<CompanySettings>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/company-settings"] });
      toast({ title: "DeepSeek settings saved" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>DeepSeek API key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>API key</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              <Input
                className="flex-1 min-w-[200px]"
                type="password"
                placeholder="sk-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                disabled={testDeepseekMut.isPending}
                onClick={() => testDeepseekMut.mutate()}
              >
                <PlugZap className="h-4 w-4 mr-2" />
                {testDeepseekMut.isPending ? "Testing…" : "Test connection"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Uses the key in this field if present; otherwise the last saved key from the server.
            </p>
          </div>
          <div>
            <Label htmlFor="deepseek-model">Model</Label>
            <Input
              id="deepseek-model"
              className="max-w-xs mt-1"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_DEEPSEEK_MODEL}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              DeepSeek model to use for AI features. Defaults to {DEFAULT_DEEPSEEK_MODEL}.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
