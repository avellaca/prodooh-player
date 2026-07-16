<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, HasUuids, Notifiable;

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
        'tenant_id',
        'email',
        'password_hash',
        'role',
        'is_active',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password_hash',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'password_hash' => 'hashed',
            'is_active' => 'boolean',
        ];
    }

    /**
     * Get the tenant that the user belongs to.
     */
    public function tenant()
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Determine if the user is a super admin.
     */
    public function isSuperAdmin(): bool
    {
        return $this->role === 'super_admin';
    }

    /**
     * Determine if the user is a tenant admin.
     */
    public function isTenantAdmin(): bool
    {
        return $this->role === 'tenant_admin';
    }

    /**
     * Determine if the user is a trafficker.
     */
    public function isTrafficker(): bool
    {
        return $this->role === 'trafficker';
    }

    /**
     * Get the password field for authentication.
     */
    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }
}
