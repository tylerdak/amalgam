import React, { useEffect, useState } from 'react';

export { useEffect, useState };

export function RawHTML({ children }) {
  return React.createElement('div', {
    dangerouslySetInnerHTML: { __html: children ?? '' },
  });
}
