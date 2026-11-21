// Materials: density (kg/m²), friction, restitution, plus how they look and sound.

export const MATERIALS = {
  wood: { name: '木头', density: 0.6, friction: 0.6, restitution: 0.15, color: '#d39a5b', edge: '#8a5a2b', sound: 'wood' },
  metal: { name: '金属', density: 4, friction: 0.35, restitution: 0.1, color: '#9aa9bd', edge: '#5b6778', sound: 'metal' },
  rubber: { name: '橡胶', density: 1.1, friction: 1.0, restitution: 0.85, color: '#ef6461', edge: '#a33a38', sound: 'rubber' },
  ice: { name: '冰', density: 0.9, friction: 0.02, restitution: 0.05, color: '#a8dcf0', edge: '#5aa5c4', sound: 'ice' },
  stone: { name: '石头', density: 2.5, friction: 0.8, restitution: 0.02, color: '#a39c90', edge: '#665f55', sound: 'stone' },
  balloon: { name: '气球', density: 0.08, friction: 0.4, restitution: 0.5, color: '#f7c948', edge: '#b88a12', sound: 'rubber', gravityScale: -3 },
  rope: { name: '绳子', density: 1.5, friction: 0.6, restitution: 0, color: '#c7a26a', edge: '#7a5c30', sound: 'wood', hidden: true }
};

// Materials offered in the picker.
export const MATERIAL_KEYS = Object.keys(MATERIALS).filter(k => !MATERIALS[k].hidden);

export const material = key => MATERIALS[key] || MATERIALS.wood;
