import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toNativeFileUrl } from './tauriBridge';

describe('toNativeFileUrl', () => {
  it('formats downloaded native paths as encoded file URLs for AVPlayer', () => {
    assert.equal(
      toNativeFileUrl('/var/mobile/Containers/Data/Application/app/Documents/Episodes/Coffee & Stuff.mp3'),
      'file:///var/mobile/Containers/Data/Application/app/Documents/Episodes/Coffee%20&%20Stuff.mp3'
    );
  });
});
