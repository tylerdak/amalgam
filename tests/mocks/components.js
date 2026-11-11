import React from 'react';

export function Notice({ children, isDismissible }) {
  return React.createElement('div', {
    role: 'alert',
    'data-dismissible': String(isDismissible),
  }, children);
}

export function Spinner() {
  return React.createElement('div', { role: 'status' }, 'Loading preview');
}
