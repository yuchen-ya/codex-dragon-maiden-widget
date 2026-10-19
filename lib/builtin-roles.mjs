export const BUILTIN_ROLES = [
  { id: 'default', name: '小龙娘 · 第一版', file: 'dragon-maiden-bust-v1.png' },
  { id: 'dragon-maiden-a', name: '小龙娘 · A版', file: 'dragon-maiden-bust-v1-a.png' },
];

export function defaultRolesIndex() {
  return {
    version: 1,
    roles: BUILTIN_ROLES.map((role, index) => ({
      id: role.id, name: role.name, format: 'png', pinnedAt: index === 0 ? 1 : null, createdAt: 0,
    })),
  };
}
