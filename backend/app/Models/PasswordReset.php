<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class PasswordReset extends Model
{
    use HasUuids;

    /**
     * Indicates that the model's ID is not auto-incrementing.
     */
    public $incrementing = false;

    /**
     * The data type of the primary key.
     */
    protected $keyType = 'string';

    /**
     * Indicates the model should not manage updated_at timestamp.
     */
    const UPDATED_AT = null;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'user_id',
        'token',
        'expires_at',
        'used_at',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }

    /**
     * Get the user that owns this password reset.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Determine if this password reset token has expired.
     */
    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    /**
     * Determine if this password reset token has been used.
     */
    public function isUsed(): bool
    {
        return $this->used_at !== null;
    }
}
