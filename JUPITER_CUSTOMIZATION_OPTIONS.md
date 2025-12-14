# Jupiter Widget Customization Options

This document lists all available customization parameters for the Jupiter Plugin widget.

## Current Implementation

The widget is currently configured with minimal settings. Below are ALL available customization options.

## 1. Display Modes

- **`displayMode`**: `"widget" | "integrated" | "modal"`
  - `"widget"`: Floating widget in corner of screen
  - `"integrated"`: Embedded directly in your layout (currently used)
  - `"modal"`: Popup overlay

## 2. Container Styling

- **`containerStyles`**: Object with CSS properties
  - `width`: Container width (e.g., `"100%"`, `"500px"`)
  - `height`: Container height (e.g., `"500px"`, `"auto"`)
  - `borderRadius`: Border radius (e.g., `"10px"`, `"0"`)
  - `overflow`: Overflow property (e.g., `"hidden"`, `"visible"`)

- **`containerClassName`**: Custom CSS class name for the container

## 3. Theme

- **`theme`**: `"dark" | "light"`
  - Currently set to `"dark"` to match Vaulto branding

## 4. Widget Style (for widget mode only)

- **`widgetStyle`**: Object
  - `position`: `"top-left" | "top-right" | "bottom-left" | "bottom-right"`
  - `size`: `"sm" | "default"`

## 5. Form Properties

- **`formProps`**: Object with swap form configuration
  - `swapMode`: `"ExactInOrOut" | "ExactIn" | "ExactOut"`
    - `"ExactIn"`: User specifies exact input amount
    - `"ExactOut"`: User specifies exact output amount
    - `"ExactInOrOut"`: User can choose (default)
  
  - `initialAmount`: Initial swap amount (string)
  - `initialInputMint`: Initial input token mint address (Solana address)
  - `initialOutputMint`: Initial output token mint address (Solana address)
  - `fixedAmount`: Boolean - lock the amount field
  - `fixedMint`: Fixed token mint address (lock one token)
  - `referralAccount`: Referral account address for fees
  - `referralFee`: Referral fee percentage (number)

## 6. Wallet Integration

- **`enableWalletPassthrough`**: Boolean
  - Allow plugin to use existing wallet connection
  
- **`passthroughWalletContextState`**: Wallet context state object
  - Pass existing wallet connection to widget
  
- **`onRequestConnectWallet`**: Callback function
  - Handle wallet connection requests

## 7. Event Handling Callbacks

- **`onSuccess`**: `(txid: string) => void`
  - Called when swap succeeds
  - Receives transaction ID
  
- **`onSwapError`**: `(error: any) => void`
  - Called when swap fails
  - Receives error object
  
- **`onFormUpdate`**: `(formData: any) => void`
  - Called when form values change
  - Useful for tracking user input
  
- **`onScreenUpdate`**: `(screen: string) => void`
  - Called when widget screen changes
  - Track user navigation within widget

## 8. Branding

- **`logoUri`**: String (URL)
  - Custom logo URL for the widget
  
- **`name`**: String
  - Custom name/branding for the plugin

## 9. Additional Options

- **`slippage`**: Number
  - Default slippage tolerance percentage (e.g., `0.5` for 0.5%)
  
- **`defaultExplorer`**: String
  - Default blockchain explorer (e.g., `"Solscan"`, `"SolanaFM"`)

## CSS Customization (Advanced)

You can also customize colors via CSS variables:

```css
:root {
  --jupiter-plugin-primary: #facc15; /* Primary color (Vaulto gold) */
  --jupiter-plugin-background: #000000; /* Background color */
  --jupiter-plugin-primaryText: #ffffff; /* Primary text color */
  --jupiter-plugin-warning: #facc15; /* Warning color */
  --jupiter-plugin-interactive: #facc15; /* Interactive elements */
  --jupiter-plugin-module: #1f2937; /* Module background */
}
```

## Example: Full Customization

```typescript
window.Jupiter.init({
  displayMode: 'integrated',
  integratedTargetId: 'jupiter-widget-container',
  
  containerStyles: {
    width: '100%',
    height: '500px',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  containerClassName: 'jupiter-widget-container',
  
  theme: 'dark',
  
  formProps: {
    swapMode: 'ExactInOrOut',
    initialAmount: '100',
    // initialInputMint: 'So11111111111111111111111111111111111111112', // SOL
    // initialOutputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    referralAccount: 'YOUR_REFERRAL_ADDRESS',
    referralFee: 0.25, // 0.25%
  },
  
  onSuccess: (txid) => {
    console.log('Swap successful:', txid);
    // Track analytics, show notification, etc.
  },
  
  onSwapError: (error) => {
    console.error('Swap failed:', error);
    // Handle error, show user feedback, etc.
  },
  
  onFormUpdate: (formData) => {
    console.log('Form updated:', formData);
    // Track user input changes
  },
  
  logoUri: 'https://app.vaulto.ai/logo.png',
  name: 'Vaulto Swap',
  
  slippage: 0.5,
  defaultExplorer: 'Solscan',
});
```









