<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
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
     * Disable updated_at timestamp (only created_at is used).
     */
    const UPDATED_AT = null;

    /**
     * Disable automatic timestamp management.
     */
    public $timestamps = false;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'auditable_type',
        'auditable_id',
        'user_id',
        'event_type',
        'diff',
        'created_at',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'diff' => 'array',
            'created_at' => 'datetime',
        ];
    }

    /**
     * Get the auditable entity (polymorphic relationship).
     */
    public function auditable()
    {
        return $this->morphTo();
    }

    /**
     * Get the user who performed the change.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
