import 'core-js/stable'
import 'regenerator-runtime/runtime'
import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'
import Registration from './components/Registration'
import ProductLinks from './components/ProductLinks'

window.React = React

function App () {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const changed = () => setHash(window.location.hash)
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return hash === '#/product-links' ? <ProductLinks /> : <Registration />
}

ReactDOM.render(<App />, document.getElementById('root'))
