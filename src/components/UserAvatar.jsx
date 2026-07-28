import { initial } from '../session.js';

export default function UserAvatar({ user, size = 32, className = 'avatar' }) {
  const style = {
    background: user?.color || '#6366f1',
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    fontSize: size > 30 ? '0.85rem' : '0.7rem',
  };
  if (user?.photoUrl) {
    return (
      <img
        className={`${className} avatar-photo`}
        src={user.photoUrl}
        alt=""
        width={size}
        height={size}
        style={style}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className={className} style={style}>
      {initial(user?.name)}
    </div>
  );
}
