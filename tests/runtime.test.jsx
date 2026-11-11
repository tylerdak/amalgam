import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyFilters, removeAllFilters } from '@wordpress/hooks';
import { getBlockType } from '@wordpress/blocks';
import { setServerRenderResponse, useServerSideRender } from '@wordpress/server-side-render';
import * as legacy from 'amalgam';
import * as editor from 'amalgam/editor';

const loading = { status: 'loading', content: undefined, error: undefined };

beforeEach(() => {
  setServerRenderResponse(loading);
  getBlockType.mockReturnValue(undefined);
  removeAllFilters('blocks.registerBlockType');
});

afterEach(cleanup);

describe('public editor exports', () => {
  it('keeps legacy and editor module identifiers on one implementation', () => {
    expect('mount' in legacy).toBe(false);
    expect(legacy.AdditionalEditContent).toBe(editor.AdditionalEditContent);
    expect(editor.ServerPreview).toEqual(expect.any(Function));
    expect(editor.registerBlockEdit).toEqual(expect.any(Function));
  });
});

describe('ServerPreview', () => {
  it('shows the first-load spinner and forwards the block name and post ID', () => {
    const attributes = { title: 'Hello' };
    const { container } = render(
      <editor.ServerPreview name="acme/banner" attributes={attributes} context={{ postId: 27 }} />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading preview');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(useServerSideRender).toHaveBeenLastCalledWith({
      block: 'acme/banner',
      attributes,
      urlQueryArgs: { post_id: 27 },
    });
  });

  it('retains the same preview nodes during loading and errors, then replaces successful HTML', async () => {
    const props = { name: 'acme/banner', attributes: {} };
    setServerRenderResponse({ status: 'success', content: '<p>First preview</p>' });
    const { container, rerender } = render(<editor.ServerPreview {...props} />);
    const wrapper = container.querySelector('[aria-busy="false"]');
    const firstMarkup = screen.getByText('First preview');

    setServerRenderResponse(loading);
    rerender(<editor.ServerPreview {...props} />);
    expect(container.querySelector('[aria-busy="true"]')).toBe(wrapper);
    expect(screen.getByText('First preview')).toBe(firstMarkup);

    setServerRenderResponse({ status: 'error', error: new Error('Preview unavailable') });
    rerender(<editor.ServerPreview {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Preview unavailable');
    expect(screen.getByRole('alert')).toHaveAttribute('data-dismissible', 'false');
    expect(screen.getByText('First preview')).toBe(firstMarkup);
    expect(container.querySelector('[aria-busy="false"]')).toBe(wrapper);

    setServerRenderResponse({ status: 'success', content: '<p>Updated preview</p>' });
    rerender(<editor.ServerPreview {...props} />);
    expect(await screen.findByText('Updated preview')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="false"]')).toBe(wrapper);
  });

  it('treats an initial error and a successful empty response as settled states', async () => {
    setServerRenderResponse({ status: 'error', error: new Error('No preview') });
    const { container, rerender } = render(<editor.ServerPreview name="acme/empty" />);
    expect(screen.getByRole('alert')).toHaveTextContent('No preview');
    expect(screen.queryByRole('status')).toBeNull();

    setServerRenderResponse({ status: 'success', content: '' });
    rerender(<editor.ServerPreview name="acme/empty" />);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-busy="false"]')).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="false"] > div')).toBeInTheDocument();
  });

  it('does not carry cached markup across block names', async () => {
    setServerRenderResponse({ status: 'success', content: '<p>First block</p>' });
    const { rerender } = render(<editor.ServerPreview name="acme/first" />);
    expect(await screen.findByText('First block')).toBeInTheDocument();

    setServerRenderResponse(loading);
    rerender(<editor.ServerPreview name="acme/second" />);
    expect(screen.queryByText('First block')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('keeps compatibility-wrapper controls mounted outside the disabled preview', () => {
    const { container, rerender } = render(
      <editor.AdditionalEditContent blockName="acme/banner">
        <aside>Editor controls</aside>
      </editor.AdditionalEditContent>
    );
    const controls = screen.getByText('Editor controls');
    expect(controls).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]').contains(controls)).toBe(false);

    setServerRenderResponse({ status: 'error', error: new Error('Unavailable') });
    rerender(
      <editor.AdditionalEditContent blockName="acme/banner">
        <aside>Editor controls</aside>
      </editor.AdditionalEditContent>
    );
    expect(screen.getByText('Editor controls')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('registerBlockEdit', () => {
  it('changes only the target block edit setting and preserves all other settings', () => {
    const OriginalEdit = () => null;
    const CustomEdit = () => null;
    const attributes = { title: { type: 'string' } };
    const supports = { align: true };
    const save = () => null;
    const settings = { edit: OriginalEdit, attributes, supports, save, transforms: [] };
    const cleanupRegistration = editor.registerBlockEdit('acme/banner', CustomEdit);

    const target = applyFilters('blocks.registerBlockType', settings, 'acme/banner');
    const other = applyFilters('blocks.registerBlockType', settings, 'acme/other');

    expect(target).toEqual({ ...settings, edit: CustomEdit });
    expect(target.attributes).toBe(attributes);
    expect(target.supports).toBe(supports);
    expect(target.save).toBe(save);
    expect(other).toBe(settings);
    cleanupRegistration();
  });

  it('replaces repeated registrations and makes stale cleanup harmless', () => {
    const FirstEdit = () => null;
    const SecondEdit = () => null;
    const firstCleanup = editor.registerBlockEdit('acme/repeat', FirstEdit);
    const secondCleanup = editor.registerBlockEdit('acme/repeat', SecondEdit);
    const settings = { edit: () => null };

    firstCleanup();
    expect(applyFilters('blocks.registerBlockType', settings, 'acme/repeat').edit).toBe(SecondEdit);

    secondCleanup();
    expect(applyFilters('blocks.registerBlockType', settings, 'acme/repeat')).toBe(settings);
  });

  it('fails clearly when called after a client-side block registration', () => {
    getBlockType.mockReturnValue({ name: 'acme/late' });
    expect(() => editor.registerBlockEdit('acme/late', () => null)).toThrow(
      /after the block has been registered.*Load this script before/s
    );
  });
});
