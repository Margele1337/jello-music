export const apiRequest = async (request) => {
  if (!window.jello?.api?.request) {
    throw new Error('API bridge is unavailable');
  }
  return window.jello.api.request(request);
};
