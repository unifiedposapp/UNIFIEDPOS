import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Shield, Plus, Trash2, Check } from 'lucide-react';

export default function PermissionsPage() {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<string[]>([]);

  const load = async () => {
    const [rolesRes, permsRes] = await Promise.all([
      api.getRoles(),
      api.getPermissions(),
    ]);
    setRoles(rolesRes.data || []);
    setPermissions(permsRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const createRole = async () => {
    await api.createRole(roleForm);
    setShowRoleForm(false);
    setRoleForm({ name: '', description: '' });
    load();
  };

  const deleteRole = async (id: string) => {
    if (!confirm('Delete this role?')) return;
    await api.deleteRole(id);
    load();
  };

  const selectRole = (role: any) => {
    setSelectedRole(role.id);
    setRolePermissions(role.permissions?.map((rp: any) => rp.permissionId || rp.permission?.id) || []);
  };

  const togglePermission = (permId: string) => {
    setRolePermissions(prev =>
      prev.includes(permId) ? prev.filter(p => p !== permId) : [...prev, permId]
    );
  };

  const savePermissions = async () => {
    if (!selectedRole) return;
    await api.assignRolePermissions(selectedRole, rolePermissions);
    load();
  };

  const seedDefaults = async () => {
    await api.seedPermissions();
    load();
  };

  // Group permissions by resource
  const groupedPerms = permissions.reduce((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = [];
    acc[p.resource].push(p);
    return acc;
  }, {} as Record<string, any[]>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Roles & Permissions</h1>
          <p className="text-gray-500">Manage employee roles and resource permissions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seedDefaults} className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700">
            <Shield size={18} /> Seed Defaults
          </button>
          <button onClick={() => setShowRoleForm(!showRoleForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus size={18} /> New Role
          </button>
        </div>
      </div>

      {showRoleForm && (
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">Create New Role</h3>
          <div className="grid grid-cols-4 gap-3">
            <input placeholder="Role Name" value={roleForm.name} onChange={e => setRoleForm({ ...roleForm, name: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="Description" value={roleForm.description} onChange={e => setRoleForm({ ...roleForm, description: e.target.value })} className="border rounded px-3 py-2" />
            <button onClick={createRole} className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700">Create</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Roles List */}
        <div className="col-span-1">
          <h3 className="font-semibold mb-3">Roles ({roles.length})</h3>
          <div className="space-y-2">
            {roles.map(role => (
              <div
                key={role.id}
                onClick={() => selectRole(role)}
                className={`bg-white border rounded-lg p-3 cursor-pointer transition-colors ${
                  selectedRole === role.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      <Shield size={14} />
                      {role.name}
                      {role.isSystem && <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">System</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">{role.description || 'No description'}</div>
                    <div className="text-xs text-blue-600 mt-1">{role.permissions?.length || 0} permissions</div>
                  </div>
                  {!role.isSystem && (
                    <button onClick={(e) => { e.stopPropagation(); deleteRole(role.id); }} className="text-red-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {roles.length === 0 && (
              <div className="text-gray-500 text-sm text-center py-4">No roles yet. Create one or seed defaults.</div>
            )}
          </div>
        </div>

        {/* Permission Matrix */}
        <div className="col-span-2">
          {selectedRole ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">
                  Permissions for {roles.find(r => r.id === selectedRole)?.name}
                </h3>
                <button onClick={savePermissions} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
                  <Check size={16} /> Save Permissions
                </button>
              </div>
              <div className="bg-white border rounded-lg divide-y max-h-[600px] overflow-y-auto">
                {Object.entries(groupedPerms).map(([resource, perms]) => (
                  <div key={resource} className="p-3">
                    <div className="text-sm font-semibold text-gray-700 mb-2 uppercase">{resource}</div>
                    <div className="flex flex-wrap gap-2">
                      {(perms as any[]).map(p => (
                        <button
                          key={p.id}
                          onClick={() => togglePermission(p.id)}
                          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                            rolePermissions.includes(p.id)
                              ? 'bg-blue-100 border-blue-300 text-blue-800'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {rolePermissions.includes(p.id) && <Check size={10} className="inline mr-1" />}
                          {p.action}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(groupedPerms).length === 0 && (
                  <div className="p-4 text-center text-gray-500 text-sm">
                    No permissions defined. Click "Seed Defaults" to create standard permissions.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
              Select a role to manage its permissions
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
