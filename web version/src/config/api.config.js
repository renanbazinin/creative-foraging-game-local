/**
 * Client-only app: no remote API. Kept for optional Vite env overrides if you fork the project.
 */

export const getApiBaseUrl = () => {
  if (import.meta?.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return '';
};

export const getHealthUrl = () => {
  if (import.meta?.env?.VITE_HEALTH_URL) {
    return import.meta.env.VITE_HEALTH_URL;
  }
  return '';
};

export const checkServerHealth = async () => ({
  status: 'local',
  version: 'client-only',
  commit: 'n/a',
  healthy: true,
  localOnly: true
});

export const getEnvironment = () => 'local';

export const isDevelopment = () => import.meta?.env?.DEV === true;

export const isProduction = () => import.meta?.env?.PROD === true;

export default {
  getApiBaseUrl,
  getHealthUrl,
  checkServerHealth,
  getEnvironment,
  isDevelopment,
  isProduction
};
