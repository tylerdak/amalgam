import { getBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { Notice, Spinner } from '@wordpress/components';
import { useDisabled } from '@wordpress/compose';
import { RawHTML, useEffect, useState } from '@wordpress/element';
import { addFilter, removeFilter } from '@wordpress/hooks';
import { useServerSideRender } from '@wordpress/server-side-render';

const registrations = new Map();

/**
 * Render a server-side block preview while preserving the last successful HTML.
 *
 * @param {{ name: string, attributes?: object, context?: { postId?: number } }} props
 */
export function ServerPreview({ name, attributes, context }) {
  const disabledRef = useDisabled();
  const blockProps = useBlockProps({ ref: disabledRef });
  const { content, status, error } = useServerSideRender({
    block: name,
    attributes,
    urlQueryArgs: context?.postId == null ? undefined : { post_id: context.postId },
  });
  const [cachedPreview, setCachedPreview] = useState({
    name,
    html: '',
    hasContent: false,
  });

  useEffect(() => {
    if (status !== 'success') {
      return;
    }

    const html = content ?? '';
    setCachedPreview((current) => {
      if (current.name === name && current.hasContent && current.html === html) {
        return current;
      }

      return { name, html, hasContent: true };
    });
  }, [content, name, status]);

  // A changed block name must not render the previous block's cached markup,
  // even during the render before the cache-resetting effect runs.
  const preview = cachedPreview.name === name
    ? cachedPreview
    : { name, html: '', hasContent: false };
  const isLoading = status === 'loading';

  return (
    <>
      {status === 'error' && (
        <Notice status="error" isDismissible={false}>
          {error?.message || String(error || 'The block preview could not be loaded.')}
        </Notice>
      )}
      <div {...blockProps} aria-busy={isLoading}>
        {!preview.hasContent && isLoading ? (
          <Spinner />
        ) : preview.hasContent ? (
          <RawHTML>{preview.html}</RawHTML>
        ) : null}
      </div>
    </>
  );
}

/**
 * Compatibility wrapper for automatically injected legacy editor scripts.
 */
export function AdditionalEditContent({ blockName, attributes, context, children }) {
  return (
    <>
      <ServerPreview name={blockName} attributes={attributes} context={context} />
      {children}
    </>
  );
}

/**
 * Replace the edit component for one block before WordPress registers it.
 *
 * @param {string} blockName
 * @param {import('react').ComponentType<any>} Edit
 * @returns {() => void} Cleanup for this registration.
 */
export function registerBlockEdit(blockName, Edit) {
  if (getBlockType(blockName)) {
    throw new Error(
      `[amalgam] Cannot register an editor for "${blockName}" after the block has been registered. ` +
      'Load this script before the script or editor bootstrap that registers the block.'
    );
  }

  const filterName = `dakin/amalgam/editor/${blockName}`;
  const registration = { token: Symbol(blockName), filterName };
  const previous = registrations.get(blockName);
  if (previous) {
    removeFilter('blocks.registerBlockType', previous.filterName);
  }

  addFilter('blocks.registerBlockType', filterName, (settings, registeredName) => (
    registeredName === blockName ? { ...settings, edit: Edit } : settings
  ));
  registrations.set(blockName, registration);

  return () => {
    if (registrations.get(blockName)?.token !== registration.token) {
      return;
    }

    removeFilter('blocks.registerBlockType', filterName);
    registrations.delete(blockName);
  };
}
