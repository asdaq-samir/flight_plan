package com.northflyers.vfr.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An endorsement an instructor signed in the app (V26): the words signed,
 * the fields they were filled in from, the signature line and the digest
 * of all three. Nothing of it changes once signed but its voiding, which a
 * correction makes (AC 120-78B 2.2.7, 2.2.8). Either account may go; the
 * other keeps it.
 */
@Entity
@Table(name = "signed_endorsements")
@Getter
public class SignedEndorsement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "student_id")
    private Pilot student;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "instructor_id")
    private Pilot instructor;

    @Column(nullable = false, length = 40)
    private String code;

    @Column(nullable = false, length = 120)
    private String studentName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, String> fields;

    @Column(nullable = false, length = 2000)
    private String text;

    @Column(nullable = false, length = 200)
    private String signature;

    @Column(nullable = false)
    private LocalDate signedOn;

    @Column(nullable = false)
    private Instant signedAt;

    @Column(nullable = false, length = 64)
    private String digest;

    private Instant voidedAt;

    protected SignedEndorsement() {
        // JPA
    }

    public SignedEndorsement(Pilot student, Pilot instructor, String code, String studentName, Map<String, String> fields,
                             String text, String signature, LocalDate signedOn, Instant signedAt, String digest) {
        this.student = student;
        this.instructor = instructor;
        this.code = code;
        this.studentName = studentName;
        this.fields = fields;
        this.text = text;
        this.signature = signature;
        this.signedOn = signedOn;
        this.signedAt = signedAt;
        this.digest = digest;
    }

    public void voidAt(Instant at) {
        this.voidedAt = at;
    }

    public boolean isVoided() {
        return voidedAt != null;
    }
}
