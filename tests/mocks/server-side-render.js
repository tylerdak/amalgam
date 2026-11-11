import { vi } from 'vitest';

let response = { content: undefined, status: 'loading', error: undefined };

export const useServerSideRender = vi.fn(() => response);

export function setServerRenderResponse(nextResponse) {
  response = nextResponse;
}
