import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck, Sparkles, UserCog, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Badge, Card, Checkbox, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { useAction } from "@/hooks/use-action";
import { select } from "@/lib/db";
import { dateTime, relative } from "@/lib/format";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/permissions";
import { call } from "@/lib/tauri";
import { initials } from "@/lib/utils";
import { useApp, usePremium } from "@/stores/app";

interface UserRow {
  id: number;
  name: string;
  username: string;
  email: string | null;
  is_active: number;
  last_login_at: string | null;
  role_id: number | null;
  role_name: string | null;
}

interface RoleRow {
  id: number;
  name: string;
  is_system: number;
  permissions: string | null;
  users: number;
}

function UserDialog({ open, onOpenChange, user, roles }: { open: boolean; onOpenChange: (o: boolean) => void; user: UserRow | null; roles: RoleRow[] }) {
  const [form, setForm] = useState({ name: "", username: "", email: "", password: "", role_id: 3, is_active: true });
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  useEffect(() => {
    if (open) {
      setForm(user ? { name: user.name, username: user.username, email: user.email ?? "", password: "", role_id: user.role_id ?? 3, is_active: !!user.is_active } : { name: "", username: "", email: "", password: "", role_id: 3, is_active: true });
      setTouched(false);
    }
  }, [open, user]);
  const errors = {
    name: form.name.trim().length < 2 ? "Le nom est obligatoire." : undefined,
    username: !/^\S{3,}$/.test(form.username.trim()) ? "3 caractères minimum, sans espace." : undefined,
    password: (!user && form.password.length < 6) || (user && form.password && form.password.length < 6) ? "6 caractères minimum." : undefined,
  };
  const submit = async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    const res = await run(() => call("users_save", { input: { id: user?.id ?? null, ...form, email: form.email || null, password: form.password || null } }), { success: user ? "Utilisateur modifié." : "Utilisateur créé." });
    if (res !== undefined) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title={user ? "Modifier l'utilisateur" : "Nouvel utilisateur"} icon={<UserCog />}>
        <DialogBody className="grid grid-cols-2 gap-3.5">
          <Field label="Nom complet" required error={touched ? errors.name : undefined} className="col-span-2">
            <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Identifiant" required error={touched ? errors.username : undefined}>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={user ? "Nouveau mot de passe" : "Mot de passe"} required={!user} error={touched ? errors.password : undefined} hint={user ? "Laisser vide pour ne pas changer." : undefined}>
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Rôle">
            <Select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: Number(e.target.value) })}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="col-span-2 flex items-center justify-between rounded-lg border p-3 text-[0.8125rem]">
            <span>
              <span className="font-medium">Compte actif</span>
              <span className="block text-[0.75rem] text-muted-foreground">Un compte désactivé ne peut plus se connecter.</span>
            </span>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit} loading={pending}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: RoleRow | null }) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const { run, pending } = useAction();
  useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setPerms(role?.permissions?.split(",").filter(Boolean) ?? ["view_dashboard", "create_sales"]);
    }
  }, [open, role]);
  const locked = role?.id === 1;
  const submit = async () => {
    if (name.trim().length < 2) return;
    const res = await run(() => call("roles_save", { input: { id: role?.id ?? null, name, permissions: perms } }), { success: "Rôle enregistré." });
    if (res !== undefined) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title={role ? `Rôle « ${role.name} »` : "Nouveau rôle personnalisé"} icon={<ShieldCheck />} description={locked ? "Le rôle Administrateur dispose de toutes les permissions et ne peut pas être modifié." : undefined}>
        <DialogBody className="space-y-4">
          <Field label="Nom du rôle" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={locked || !!role?.is_system} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            {PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2.5 rounded-md border px-3 py-2 text-[0.8125rem]">
                <Checkbox checked={locked || perms.includes(p)} disabled={locked} onCheckedChange={(v) => setPerms((cur) => (v ? [...cur, p] : cur.filter((x) => x !== p)))} />
                {PERMISSION_LABELS[p]}
              </label>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          {!locked && (
            <Button onClick={submit} loading={pending}>
              Enregistrer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const premium = usePremium();
  const gate = usePremiumGate();
  const me = useApp((s) => s.session?.user_id);
  const [userOpen, setUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null);

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: () =>
      select<UserRow>("SELECT u.id, u.name, u.username, u.email, u.is_active, u.last_login_at, r.id AS role_id, r.name AS role_name FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id ORDER BY u.id"),
  });
  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: () =>
      select<RoleRow>(
        "SELECT r.id, r.name, r.is_system, (SELECT GROUP_CONCAT(permission_code) FROM role_permissions WHERE role_id = r.id) AS permissions, (SELECT COUNT(*) FROM user_roles WHERE role_id = r.id) AS users FROM roles r ORDER BY r.id",
      ),
  });

  if (!premium)
    return (
      <Page>
        <PageHeader title="Utilisateurs" />
        <Card>
          <EmptyState
            icon={<Users />}
            title="Utilisateurs multiples avec Premium"
            description="Créez un compte pour chaque employé (caissier, magasinier, gérant) et contrôlez précisément ce que chacun peut voir et faire."
            actions={
              <Button onClick={() => gate.open("users")}>
                <Sparkles /> Découvrir Premium
              </Button>
            }
          />
        </Card>
      </Page>
    );

  return (
    <Page>
      <PageHeader
        title="Utilisateurs"
        description="Comptes, rôles et permissions de votre équipe."
        actions={
          <Button
            onClick={() => {
              setEditingUser(null);
              setUserOpen(true);
            }}
          >
            <Plus /> Nouvel utilisateur
          </Button>
        }
      />
      <Tabs defaultValue="users">
        <TabsList className="mb-4">
          <TabsTrigger value="users">Utilisateurs ({users.length})</TabsTrigger>
          <TabsTrigger value="roles">Rôles et permissions</TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <Card className="overflow-hidden">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-b bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5">Utilisateur</th>
                  <th className="px-3 py-2.5">Rôle</th>
                  <th className="px-3 py-2.5">Statut</th>
                  <th className="px-3 py-2.5">Dernière connexion</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[0.75rem] font-bold text-primary">{initials(u.name)}</span>
                        <div>
                          <div className="font-medium">
                            {u.name} {u.id === me && <span className="text-[0.75rem] font-normal text-muted-foreground">(vous)</span>}
                          </div>
                          <div className="text-[0.75rem] text-muted-foreground">{u.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3">
                      <Badge tone={u.role_id === 1 ? "primary" : "neutral"}>{u.role_name ?? "—"}</Badge>
                    </td>
                    <td className="px-3">{u.is_active ? <Badge tone="success" dot>Actif</Badge> : <Badge dot>Désactivé</Badge>}</td>
                    <td className="px-3 text-muted-foreground" title={dateTime(u.last_login_at)}>
                      {u.last_login_at ? relative(u.last_login_at) : "Jamais"}
                    </td>
                    <td className="pr-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          setEditingUser(u);
                          setUserOpen(true);
                        }}
                        aria-label="Modifier"
                      >
                        <Pencil />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>
        <TabsContent value="roles">
          <div className="mb-3 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                setEditingRole(null);
                setRoleOpen(true);
              }}
            >
              <Plus /> Rôle personnalisé
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {roles.map((r) => {
              const list = r.permissions?.split(",").filter(Boolean) ?? [];
              return (
                <Card
                  key={r.id}
                  className="cursor-pointer p-5 transition-shadow hover:shadow-md"
                  onClick={() => {
                    setEditingRole(r);
                    setRoleOpen(true);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold">{r.name}</div>
                    <Badge tone={r.is_system ? "neutral" : "primary"}>{r.is_system ? "Système" : "Personnalisé"}</Badge>
                  </div>
                  <div className="mt-1 text-[0.75rem] text-muted-foreground">
                    {r.users} utilisateur(s) · {list.length} permission(s)
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {list.slice(0, 6).map((p) => (
                      <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                        {PERMISSION_LABELS[p as keyof typeof PERMISSION_LABELS] ?? p}
                      </span>
                    ))}
                    {list.length > 6 && <span className="text-[0.6875rem] text-muted-foreground">+{list.length - 6}</span>}
                  </div>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
      <UserDialog open={userOpen} onOpenChange={setUserOpen} user={editingUser} roles={roles} />
      <RoleDialog open={roleOpen} onOpenChange={setRoleOpen} role={editingRole} />
    </Page>
  );
}
