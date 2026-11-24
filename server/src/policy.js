export const actions = ['view', 'download', 'edit', 'delete', 'manageAccess'];
export const permissions = [...actions, 'upload', 'manageEmployees', 'audit'];
export const classifications = ['Public', 'Internal', 'Confidential', 'Restricted'];
export const can = (user, action) => user.admin || user.permissions.includes(action);

export function documentAccess(user, document, action) {
  if (!user.active || user.organizationId !== document.organizationId || document.deletedAt) return false;
  if (!can(user, action)) return false;
  const applicable = document.grants.filter(grant =>
    grant.action === action && (
      (grant.kind === 'employee' && grant.targetId === user.id) ||
      (grant.kind === 'department' && grant.targetId === user.departmentId) ||
      (grant.kind === 'role' && grant.targetId === user.roleId)
    )
  );
  if (applicable.some(grant => grant.effect === 'deny')) return false;
  if (user.admin || user.id === document.ownerId) return true;
  return applicable.some(grant => grant.effect === 'allow' && (
    document.classification === 'Restricted' ? grant.kind === 'employee' :
    document.classification === 'Confidential' ? grant.kind !== 'department' : true
  ));
}
