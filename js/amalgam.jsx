import { useBlockProps, HtmlRenderer } from '@wordpress/block-editor';
import { useDisabled } from '@wordpress/compose';
import { useServerSideRender } from '@wordpress/server-side-render';

export function mount(component, props, callback) {
  // register block
}

export function AdditionalEditContent({ blockName, attributes, children }) {
  const disabledRef = useDisabled();
  const blockProps = useBlockProps( { ref: disabledRef } );
  const { content, status, error } = useServerSideRender( {
    block: blockName,
    attributes,
  } );

  console.log(content)

  if ( status === 'loading' ) {
    return (
      <div { ...blockProps }>{  'Loading…'  }</div>
    );
  }

  if ( status === 'error' ) {
    return (
      <div { ...blockProps }>
        { sprintf(
          /* translators: %s: error message describing the problem */
           'Error loading block: %s' ,
          error
        ) }
      </div>
    );
  }

  return (
    <>

      {children}

      <div
        { ...blockProps }
        dangerouslySetInnerHTML={ {
          __html: content || '',
        } }
      />
    </>);
}
