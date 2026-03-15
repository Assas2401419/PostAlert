import { NextResponse } from 'next/server.js';

import { PlatformError } from './platform-store.js';

export function ok(data, init = {}) {
  return NextResponse.json(data, init);
}

export function fail(error) {
  if (error instanceof PlatformError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code
      },
      { status: error.status }
    );
  }

  console.error(error);
  return NextResponse.json(
    {
      error: 'Unexpected server error.',
      code: 500
    },
    { status: 500 }
  );
}
