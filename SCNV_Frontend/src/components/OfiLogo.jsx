import React from 'react';

/**
 * FrieslandCampina Logo component — uses the official logo image.
 * Renders the logo at different sizes with optional click handler.
 */
function OfiLogo({ size = 'default', showTagline = true, onClick, style }) {
  const sizes = {
    small:   { height: 36 },
    default: { height: 52 },
    large:   { height: 72 },
    hero:    { height: 100 },
  };

  const s = sizes[size] || sizes.default;

  return (
    <div
      className="ofi-logo"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
        ...style,
      }}
    >
      <img
        src="/frieslandcampina-logo.png"
        alt="FrieslandCampina — nourishing by nature"
        style={{
          height: `${s.height}px`,
          width: 'auto',
          objectFit: 'contain',
          display: 'block',
          // If tagline is hidden (e.g., collapsed header), crop to show just the star + name
          maxWidth: showTagline ? '240px' : `${s.height * 2.8}px`,
        }}
        draggable={false}
      />
    </div>
  );
}

export default OfiLogo;
